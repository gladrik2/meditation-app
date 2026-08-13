import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BrowserGoogleDrivePicker,
  type GooglePickerApi
} from './googleDrivePicker'

describe('BrowserGoogleDrivePicker', () => {
  let callback: ((data: object) => void) | undefined

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window.google as typeof window.google & { picker?: unknown })
      ?.picker
  })

  function installPicker() {
    const enableFeature = vi.fn()
    class DocsView {
      setIncludeFolders = vi.fn()
      setSelectFolderEnabled = vi.fn()
    }
    class PickerBuilder {
      addView = vi.fn().mockReturnThis()
      enableFeature(value: string) {
        enableFeature(value)
        return this
      }
      setAppId = vi.fn().mockReturnThis()
      setCallback = vi.fn((value) => {
        callback = value
        return this
      })
      setDeveloperKey = vi.fn().mockReturnThis()
      setOAuthToken = vi.fn().mockReturnThis()
      build = vi.fn(() => ({ setVisible: vi.fn() }))
    }
    const picker = {
      Action: { CANCEL: 'cancel', PICKED: 'picked' },
      DocsView,
      Feature: { MULTISELECT_ENABLED: 'multiselect' },
      PickerBuilder,
      ViewId: { DOCS: 'docs' }
    } as unknown as GooglePickerApi
    window.google = { picker } as typeof window.google & {
      picker: GooglePickerApi
    }
    return enableFeature
  }

  it('downloads every selected file and preserves its name and MIME type', async () => {
    const enableFeature = installPicker()
    const fetchFile = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('audio bytes', {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' }
        })
      )
      .mockResolvedValueOnce(new Response('image bytes', { status: 200 }))
    const picker = new BrowserGoogleDrivePicker('api-key', 'app-id', fetchFile)

    const result = picker.pickFiles('access-token')
    await Promise.resolve()
    callback?.({
      action: 'picked',
      docs: [
        { id: 'audio/id', name: 'rain.wav', mimeType: 'audio/wav' },
        { id: 'image-id', name: 'forest.jpg', mimeType: 'image/jpeg' }
      ]
    })

    const files = await result
    expect(files?.map(({ name, type }) => ({ name, type }))).toEqual([
      { name: 'rain.wav', type: 'audio/wav' },
      { name: 'forest.jpg', type: 'image/jpeg' }
    ])
    expect(fetchFile).toHaveBeenNthCalledWith(
      1,
      'https://www.googleapis.com/drive/v3/files/audio%2Fid?alt=media',
      { headers: { Authorization: 'Bearer access-token' } }
    )
    expect(enableFeature).toHaveBeenCalledWith('multiselect')
  })

  it('rejects with a clear error when a selected file cannot be downloaded', async () => {
    installPicker()
    const picker = new BrowserGoogleDrivePicker(
      'api-key',
      undefined,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 403 }))
    )

    const result = picker.pickFiles('access-token')
    await Promise.resolve()
    callback?.({
      action: 'picked',
      docs: [{ id: 'file-id', name: 'rain.wav', mimeType: 'audio/wav' }]
    })

    await expect(result).rejects.toThrow(
      'Could not download “rain.wav” from Google Drive (403).'
    )
  })
})
