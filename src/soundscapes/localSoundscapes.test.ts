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
                  { type: 'audio/opus' }
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

    await store.save(
      structuredClone(manifest),
      new Map([['rain.opus', source]])
    )
    const restored = await store.restoreLast()

    expect(restored?.manifest.name).toBe('Offline')
    expect([...restored!.files.values()][0].name).toContain('rain.opus')

    await store.delete(manifest.id)
    expect(await store.restoreLast()).toBeUndefined()
    expect(directories.has(manifest.id)).toBe(false)
  })

  it('reports persistent-storage denial without failing', async () => {
    vi.mocked(navigator.storage.persist).mockResolvedValue(false)
    await expect(new LocalSoundscapeStore().requestPersistence()).resolves.toBe(
      false
    )
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
