import { describe, expect, it, vi } from 'vitest'
import {
  downloadGoogleDriveFiles,
  isSupportedDriveDocument,
  type GoogleDriveDocument
} from './googleDriveFiles'

const driveDocument = (
  name: string,
  mimeType: string
): GoogleDriveDocument => ({ id: 'drive-id', name, mimeType })

describe('Google Drive file classification', () => {
  it.each([
    ['recording.opus', 'text/plain'],
    ['recording', 'application/octet-stream'],
    ['recording', ''],
    ['recording.ogg', 'application/ogg']
  ])('allows plausible audio %s with MIME type %s', (name, mimeType) => {
    expect(isSupportedDriveDocument(driveDocument(name, mimeType))).toBe(true)
  })

  it.each([
    ['cover.jpg', 'image/jpeg'],
    ['cover', 'image/png']
  ])('allows image %s with MIME type %s', (name, mimeType) => {
    expect(isSupportedDriveDocument(driveDocument(name, mimeType))).toBe(true)
  })

  it.each([
    ['notes.txt', 'text/plain'],
    ['document.pdf', 'application/pdf']
  ])('rejects definite non-media %s with MIME type %s', (name, mimeType) => {
    expect(isSupportedDriveDocument(driveDocument(name, mimeType))).toBe(false)
  })

  it('downloads an Opus file even when Drive reports a non-audio MIME type', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['opus']))
    })

    const files = await downloadGoogleDriveFiles(
      [driveDocument('meditation.opus', 'text/plain')],
      'token',
      fetcher
    )

    expect(fetcher).toHaveBeenCalledOnce()
    expect(files[0]).toEqual(
      expect.objectContaining({ name: 'meditation.opus', type: 'text/plain' })
    )
  })

  it('rejects definite non-media before downloading it', async () => {
    const fetcher = vi.fn()

    await expect(
      downloadGoogleDriveFiles(
        [driveDocument('document.pdf', 'application/pdf')],
        'token',
        fetcher
      )
    ).rejects.toThrow(/only add audio and image/i)
    expect(fetcher).not.toHaveBeenCalled()
  })
})
