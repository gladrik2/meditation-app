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
                files.set(
                  `${name}/${filename}`,
                  new File(chunks as unknown as BlobPart[], filename, {
                    type: 'audio/opus'
                  })
                )
              }
            }) as FileSystemWritableFileStream
          }
        } as FileSystemFileHandle
      }
    ),
    removeEntry: vi.fn(async (child: string) => {
      directories.delete(child)
      for (const key of files.keys())
        if (key.startsWith(`${child}/`)) files.delete(key)
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

    await store.save(manifest, new Map([['rain.opus', source]]))
    const restored = await store.restoreLast()

    expect(restored?.manifest.name).toBe('Offline')
    expect(restored?.files.get('rain.opus')?.name).toBe('rain.opus')

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
      store.save(manifest, new Map([['rain.opus', broken]]))
    ).rejects.toThrow('interrupted')
    expect(await store.restoreLast()).toBeUndefined()
  })
})
