import { describe, expect, it, vi } from 'vitest'
import type { LocalSoundscapeStore } from '../soundscapes/localSoundscapes'
import type { SoundscapeManifest } from '../soundscapes/manifest'
import {
  importDriveSoundscape,
  mapWithConcurrency
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
  it('uses a cached file when Drive metadata has not changed', async () => {
    const savedFile = new File(['rain'], 'rain.opus')
    const store = {
      restore: vi.fn().mockResolvedValue({
        manifest: manifest(),
        files: new Map([['rain.opus', savedFile]])
      }),
      save: vi.fn()
    } as unknown as LocalSoundscapeStore
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(manifest()))
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
      save: vi.fn()
    } as unknown as LocalSoundscapeStore
    const download = {
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['new-rain']))
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
    expect(store.save).toHaveBeenCalledOnce()
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
