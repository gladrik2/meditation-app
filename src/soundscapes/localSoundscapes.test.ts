import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoundscapeManifest } from './manifest'
import { LocalSoundscapeStore } from './localSoundscapes'

const files = new Map<string, File>()
const directories = new Map<string, FileSystemDirectoryHandle>()

const directory = (name: string): FileSystemDirectoryHandle =>
  ({
    name,
    kind: 'directory',
    getDirectoryHandle: vi.fn(async (child: string) => {
      const found = directories.get(child)
      if (!found) throw new DOMException('Missing', 'NotFoundError')
      return found
    }),
    getFileHandle: vi.fn(
      async (filename: string, options?: { create?: boolean }) => {
        if (!options?.create && !files.has(`${name}/${filename}`))
          throw new DOMException('Missing', 'NotFoundError')
        return {
          name: filename,
          kind: 'file',
          getFile: async () => files.get(`${name}/${filename}`)!,
          createWritable: async () => {
            const chunks: Uint8Array[] = []
            return new WritableStream<Uint8Array>({
              write: (chunk) => {
                chunks.push(chunk)
              },
              close: () => {
                const stored = new File(
                  chunks as unknown as BlobPart[],
                  filename,
                  { type: '' }
                )
                Object.defineProperty(stored, 'stream', {
                  value: () =>
                    new ReadableStream({
                      start(controller) {
                        for (const chunk of chunks) controller.enqueue(chunk)
                        controller.close()
                      }
                    })
                })
                files.set(`${name}/${filename}`, stored)
              }
            }) as FileSystemWritableFileStream
          }
        } as FileSystemFileHandle
      }
    ),
    removeEntry: vi.fn(async (child: string) => {
      if (name === 'root') {
        directories.delete(child)
        for (const key of files.keys())
          if (key.startsWith(`${child}/`)) files.delete(key)
      } else {
        files.delete(`${name}/${child}`)
      }
    })
  }) as unknown as FileSystemDirectoryHandle

const manifest: SoundscapeManifest = {
  version: 1,
  id: 'offline-soundscape',
  name: 'Offline',
  updatedAt: '2026-08-14T00:00:00.000Z',
  masterVolume: 0.5,
  timerSettings: { mode: 'stopwatch', minutes: 10, startMedia: true },
  tracks: [
    {
      name: 'rain.opus',
      mimeType: 'audio/opus',
      size: 5,
      volume: 0.6,
      isSoundEffect: false,
      effectChance: 50,
      reference: { localPath: 'rain.opus' }
    }
  ]
}

const streamFile = (name: string) => {
  const file = new File(['audio'], name, { type: 'audio/opus' })
  Object.defineProperty(file, 'stream', {
    value: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(name))
          controller.close()
        }
      })
  })
  return file
}

describe('LocalSoundscapeStore', () => {
  beforeEach(() => {
    files.clear()
    directories.clear()
    localStorage.clear()
    const root = directory('root')
    vi.spyOn(root, 'getDirectoryHandle').mockImplementation(
      async (name: string, options?: FileSystemGetDirectoryOptions) => {
        let found = directories.get(name)
        if (!found && options?.create) {
          found = directory(name)
          directories.set(name, found)
        }
        if (!found) throw new DOMException('Missing', 'NotFoundError')
        return found
      }
    )
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { getDirectory: vi.fn().mockResolvedValue(root), persist: vi.fn() }
    })
  })

  it('streams media to OPFS, restores it offline, and deletes its cache', async () => {
    const source = new File(['audio'], 'rain.opus', { type: 'audio/opus' })
    Object.defineProperty(source, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('audio'))
            controller.close()
          }
        })
    })
    const store = new LocalSoundscapeStore()
    const savedManifest = structuredClone(manifest)
    savedManifest.timerSettings = {
      mode: 'countdown',
      minutes: 25,
      startMedia: false
    }

    await store.save(savedManifest, new Map([['rain.opus', source]]))
    const restored = await store.restoreLast()

    expect(restored?.manifest.name).toBe('Offline')
    expect(restored?.manifest.timerSettings).toEqual({
      mode: 'countdown',
      minutes: 25,
      startMedia: false
    })
    expect([...restored!.files.values()][0]).toMatchObject({
      name: 'rain.opus',
      type: 'audio/opus'
    })
    expect([...files.values()][0]).toMatchObject({
      name: expect.stringMatching(/rain\.opus\..+\.media$/),
      type: ''
    })
    expect((await store.list()).map(({ name }) => name)).toContain('Offline')

    await store.delete(manifest.id)
    expect(await store.restoreLast()).toBeUndefined()
    expect(directories.has(manifest.id)).toBe(false)
  })

  it('restores a timer-only soundscape without requiring an OPFS directory', async () => {
    const store = new LocalSoundscapeStore()
    const timerOnly: SoundscapeManifest = {
      version: 1,
      id: 'timer-only',
      name: 'Timer only',
      updatedAt: '2026-08-18T00:00:00.000Z',
      masterVolume: 1,
      timerSettings: { mode: 'countdown', minutes: 25, startMedia: false },
      tracks: []
    }

    await store.save(timerOnly, new Map())

    expect(directories.has(timerOnly.id)).toBe(false)
    await expect(store.restore(timerOnly.id)).resolves.toEqual({
      manifest: timerOnly,
      files: new Map()
    })
    await expect(store.restoreLast()).resolves.toEqual({
      manifest: timerOnly,
      files: new Map()
    })
    await store.delete(timerOnly.id)
  })

  it('reports persistent-storage denial without failing', async () => {
    vi.mocked(navigator.storage.persist).mockResolvedValue(false)
    await expect(new LocalSoundscapeStore().requestPersistence()).resolves.toBe(
      false
    )
  })

  it('opens and deletes multiple records independently', async () => {
    const store = new LocalSoundscapeStore()
    const first = structuredClone(manifest)
    first.id = 'first-id'
    first.name = 'Soundscape 1'
    const second = structuredClone(manifest)
    second.id = 'second-id'
    second.name = 'Soundscape 2'

    await store.save(first, new Map([['rain.opus', streamFile('first.opus')]]))
    await store.save(
      second,
      new Map([['rain.opus', streamFile('second.opus')]])
    )

    expect((await store.list()).map(({ name }) => name).sort()).toEqual([
      'Soundscape 1',
      'Soundscape 2'
    ])
    expect((await store.restore('first-id'))?.manifest.name).toBe(
      'Soundscape 1'
    )
    expect((await store.restore('second-id'))?.manifest.name).toBe(
      'Soundscape 2'
    )

    await store.delete('first-id')
    expect(await store.restore('first-id')).toBeUndefined()
    expect((await store.restore('second-id'))?.manifest.name).toBe(
      'Soundscape 2'
    )
    expect((await store.list()).map(({ name }) => name)).toEqual([
      'Soundscape 2'
    ])
  })

  it('renames only manifest metadata while preserving identity and media', async () => {
    const store = new LocalSoundscapeStore()
    const saved = structuredClone(manifest)
    saved.tracks[0].reference.driveFileId = 'drive-media-id'
    await store.save(saved, new Map([['rain.opus', streamFile('rain.opus')]]))
    const before = await store.restore(saved.id)
    const originalPath = before!.manifest.tracks[0].reference.localPath
    const originalFiles = [...files.keys()]
    const writeMedia = vi.spyOn(store, 'writeMedia')

    const renamed = await store.rename(saved.id, '  Evening rain  ')
    const after = await store.restore(saved.id)

    expect(renamed).toMatchObject({ id: saved.id, name: 'Evening rain' })
    expect(renamed.updatedAt).not.toBe(saved.updatedAt)
    expect(after!.manifest.tracks[0].reference).toMatchObject({
      localPath: originalPath,
      driveFileId: 'drive-media-id'
    })
    expect([...files.keys()]).toEqual(originalFiles)
    expect(writeMedia).not.toHaveBeenCalled()
    expect(localStorage.getItem('last-soundscape-id')).toBe(saved.id)
  })

  it('upserts one record when the same Drive manifest ID is cached repeatedly', async () => {
    const store = new LocalSoundscapeStore()
    const saved = structuredClone(manifest)
    saved.tracks[0].reference.driveFileId = 'drive-media-id'
    await store.save(saved, new Map([['rain.opus', streamFile('rain.opus')]]))
    const restored = await store.restore(saved.id)
    const originalPath = restored!.manifest.tracks[0].reference.localPath
    const physicalFiles = () =>
      [...files.keys()].filter((path) => path.startsWith(`${saved.id}/`))

    restored!.manifest.masterVolume = 0.4
    restored!.manifest.tracks[0].volume = 0.3
    await store.save(restored!.manifest, new Map())
    await store.save(restored!.manifest, new Map())

    expect(restored!.manifest.tracks[0].reference.localPath).toBe(originalPath)
    expect(physicalFiles()).toEqual([`${saved.id}/${originalPath}`])
    expect(
      (await store.list()).filter(({ id }) => id === saved.id)
    ).toHaveLength(1)
  })

  it('rewrites and removes only replaced or removed media', async () => {
    const store = new LocalSoundscapeStore()
    const saved = structuredClone(manifest)
    saved.tracks.push({
      ...saved.tracks[0],
      name: 'birds.opus',
      reference: { localPath: 'birds.opus' }
    })
    await store.save(
      saved,
      new Map([
        ['rain.opus', streamFile('rain.opus')],
        ['birds.opus', streamFile('birds.opus')]
      ])
    )
    const rainPath = saved.tracks[0].reference.localPath
    const oldBirdsPath = saved.tracks[1].reference.localPath
    saved.tracks[1].reference.localPath = 'replacement.opus'

    await store.save(
      saved,
      new Map([['replacement.opus', streamFile('replacement.opus')]])
    )

    expect(saved.tracks[0].reference.localPath).toBe(rainPath)
    expect(files.has(`${saved.id}/${rainPath}`)).toBe(true)
    expect(files.has(`${saved.id}/${oldBirdsPath}`)).toBe(false)
    expect(
      files.has(`${saved.id}/${saved.tracks[1].reference.localPath}`)
    ).toBe(true)

    saved.tracks.pop()
    await store.save(saved, new Map())
    expect(
      [...files.keys()].filter((path) => path.startsWith(`${saved.id}/`))
    ).toEqual([`${saved.id}/${rainPath}`])
  })

  it('maps OPFS NetworkError failures to a useful local-storage error', async () => {
    const inaccessible = new File(['audio'], 'rain.opus')
    Object.defineProperty(inaccessible, 'stream', {
      value: () => {
        throw new DOMException('NetworkError', 'NetworkError')
      }
    })

    await expect(
      new LocalSoundscapeStore().save(
        structuredClone(manifest),
        new Map([['rain.opus', inaccessible]])
      )
    ).rejects.toThrow(/Local browser storage could not read or write/i)
  })

  it('deletes obsolete OPFS files when overwriting a soundscape', async () => {
    const store = new LocalSoundscapeStore()
    const source = new File(['audio'], 'rain.opus')
    Object.defineProperty(source, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('audio'))
            controller.close()
          }
        })
    })
    const overwritten = structuredClone(manifest)
    await store.save(overwritten, new Map([['rain.opus', source]]))
    const oldPath = overwritten.tracks[0].reference.localPath
    await store.commitManifest({ ...overwritten, tracks: [] })
    expect(files.has(`${manifest.id}/${oldPath}`)).toBe(false)
  })

  it('keeps previous media when the replacement manifest commit fails', async () => {
    const store = new LocalSoundscapeStore()
    const source = new File(['audio'], 'rain.opus')
    Object.defineProperty(source, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
            controller.close()
          }
        })
    })
    const saved = structuredClone(manifest)
    await store.save(saved, new Map([['rain.opus', source]]))
    const oldPath = saved.tracks[0].reference.localPath
    const put = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementationOnce(() => {
        throw new Error('IndexedDB commit failed')
      })

    await expect(
      store.commitManifest({ ...saved, tracks: [] })
    ).rejects.toThrow('IndexedDB commit failed')
    put.mockRestore()
    expect(files.has(`${manifest.id}/${oldPath}`)).toBe(true)
  })

  it('does not publish metadata after an interrupted OPFS transfer', async () => {
    const broken = new File(['audio'], 'rain.opus')
    Object.defineProperty(broken, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.error(new Error('interrupted'))
          }
        })
    })
    const store = new LocalSoundscapeStore()

    await expect(
      store.save(structuredClone(manifest), new Map([['rain.opus', broken]]))
    ).rejects.toThrow('interrupted')
    expect(await store.restoreLast()).toBeUndefined()
  })

  it('removes every staged file when a later media transfer fails', async () => {
    const first = new File(['first'], 'first.opus')
    Object.defineProperty(first, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('first'))
            controller.close()
          }
        })
    })
    const second = new File(['second'], 'second.opus')
    Object.defineProperty(second, 'stream', {
      value: () =>
        new ReadableStream({
          start(controller) {
            controller.error(new Error('second transfer failed'))
          }
        })
    })
    const multiFileManifest = structuredClone(manifest)
    multiFileManifest.tracks.push({
      ...multiFileManifest.tracks[0],
      name: 'second.opus',
      reference: { localPath: 'second.opus' }
    })

    await expect(
      new LocalSoundscapeStore().save(
        multiFileManifest,
        new Map([
          ['rain.opus', first],
          ['second.opus', second]
        ])
      )
    ).rejects.toThrow('second transfer failed')

    expect(
      [...files.keys()].filter((path) => path.startsWith(`${manifest.id}/`))
    ).toEqual([])
    expect(await new LocalSoundscapeStore().restoreLast()).toBeUndefined()
  })
})
