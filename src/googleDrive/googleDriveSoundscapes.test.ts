import { describe, expect, it, vi } from 'vitest'
import type { LocalSoundscapeStore } from '../soundscapes/localSoundscapes'
import type { SoundscapeManifest } from '../soundscapes/manifest'
import {
  importDriveSoundscape,
  mapWithConcurrency,
  publishSoundscape
} from './googleDriveSoundscapes'

const manifest = (): SoundscapeManifest => ({
  version: 1,
  id: 'landscape',
  name: 'Landscape',
  updatedAt: '2026-08-14T00:00:00.000Z',
  masterVolume: 1,
  tracks: [
    {
      name: 'rain.opus',
      mimeType: 'audio/opus',
      size: 4,
      volume: 1,
      isSoundEffect: false,
      effectChance: 50,
      reference: {
        localPath: 'rain.opus',
        driveFileId: 'media-id',
        driveModifiedTime: 'old-time',
        driveSize: '4'
      }
    }
  ]
})

const response = (body: unknown) =>
  ({ ok: true, json: vi.fn().mockResolvedValue(body) }) as unknown as Response

describe('Google Drive soundscapes', () => {
  it('publishes cache validation metadata in soundscape.json', async () => {
    const published = manifest()
    const uploadStart = () =>
      ({
        ok: true,
        headers: new Headers({ Location: 'https://upload.test/session' })
      }) as Response
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'folder-id' }))
      .mockResolvedValueOnce(uploadStart())
      .mockResolvedValueOnce(
        response({
          id: 'uploaded-media',
          modifiedTime: 'published-time',
          size: '4',
          md5Checksum: 'checksum'
        })
      )
      .mockResolvedValueOnce(uploadStart())
      .mockResolvedValueOnce(response({ id: 'manifest-id' }))

    await publishSoundscape(
      published,
      new Map([['rain.opus', new File(['rain'], 'rain.opus')]]),
      'token',
      fetcher
    )

    expect(published.tracks[0].reference).toMatchObject({
      driveFileId: 'uploaded-media',
      driveModifiedTime: 'published-time',
      driveSize: '4',
      driveChecksum: 'checksum'
    })
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('fields=id,modifiedTime,size,md5Checksum'),
      expect.anything()
    )
  })

  it('uses a cached file when Drive metadata has not changed', async () => {
    const savedFile = new File(['rain'], 'rain.opus')
    const driveManifest = manifest()
    delete driveManifest.tracks[0].reference.driveModifiedTime
    delete driveManifest.tracks[0].reference.driveSize
    const store = {
      restore: vi.fn().mockResolvedValue({
        manifest: manifest(),
        files: new Map([['rain.opus', savedFile]])
      }),
      commitManifest: vi.fn()
    } as unknown as LocalSoundscapeStore
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(driveManifest))
      .mockResolvedValueOnce(
        response({ id: 'media-id', modifiedTime: 'old-time', size: '4' })
      )

    const imported = await importDriveSoundscape(
      'manifest-id',
      'token',
      store,
      fetcher
    )

    expect(imported.files.get('rain.opus')).toBe(savedFile)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('redownloads a cached file when Drive metadata changed', async () => {
    const store = {
      restore: vi.fn().mockResolvedValue({
        manifest: manifest(),
        files: new Map([['rain.opus', new File(['old'], 'rain.opus')]])
      }),
      writeMedia: vi.fn().mockResolvedValue('rain-new.media'),
      commitManifest: vi.fn()
    } as unknown as LocalSoundscapeStore
    const download = {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('new-rain'))
          controller.close()
        }
      })
    } as unknown as Response
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(manifest()))
      .mockResolvedValueOnce(
        response({ id: 'media-id', modifiedTime: 'new-time', size: '8' })
      )
      .mockResolvedValueOnce(download)

    await importDriveSoundscape('manifest-id', 'token', store, fetcher)

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(store.writeMedia).toHaveBeenCalledOnce()
    expect(store.commitManifest).toHaveBeenCalledOnce()
  })

  it('removes all staged Drive files when a later transfer fails', async () => {
    const incoming = manifest()
    incoming.tracks.push({
      ...incoming.tracks[0],
      name: 'birds.opus',
      reference: { localPath: 'birds.opus', driveFileId: 'birds-id' }
    })
    const store = {
      restore: vi.fn().mockResolvedValue(undefined),
      writeMedia: vi
        .fn()
        .mockResolvedValueOnce('rain-staged.media')
        .mockRejectedValueOnce(new Error('birds transfer failed')),
      removeMedia: vi.fn(),
      commitManifest: vi.fn()
    } as unknown as LocalSoundscapeStore
    const streamResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1]))
          controller.close()
        }
      })
    } as unknown as Response
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(incoming))
      .mockResolvedValueOnce(response({ id: 'media-id', size: '4' }))
      .mockResolvedValueOnce(response({ id: 'birds-id', size: '5' }))
      .mockResolvedValueOnce(streamResponse)
      .mockResolvedValueOnce(streamResponse)

    await expect(
      importDriveSoundscape('manifest-id', 'token', store, fetcher)
    ).rejects.toThrow('birds transfer failed')

    expect(store.removeMedia).toHaveBeenCalledWith('landscape', [
      'rain-staged.media'
    ])
    expect(store.commitManifest).not.toHaveBeenCalled()
  })

  it('limits parallel transfers', async () => {
    let active = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return value
    })
    expect(peak).toBe(2)
  })
})
