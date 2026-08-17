import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockEngine } from '../test/mockEngine'
import { AudioEngineLoadError } from '../audio/types'
import { App } from './App'
import { LocalSoundscapeStore } from '../soundscapes/localSoundscapes'
import type { SoundscapeManifest } from '../soundscapes/manifest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'

const driveOperations = vi.hoisted(() => ({
  importSoundscape: vi.fn(),
  publishSoundscape: vi.fn()
}))

vi.mock('../googleDrive/googleDriveSoundscapes', () => ({
  importDriveSoundscape: driveOperations.importSoundscape,
  publishSoundscape: driveOperations.publishSoundscape
}))

vi.mock('@googleworkspace/drive-picker-react', () => ({
  DrivePicker: ({ onPicked }: { onPicked(event: object): void }) => (
    <button
      type="button"
      onClick={() =>
        onPicked({ detail: { docs: [{ id: 'drive-manifest-id' }] } })
      }
    >
      Pick saved Drive soundscape
    </button>
  ),
  DrivePickerDocsView: () => null
}))

const audioFile = (name: string) =>
  new File(['not-real-audio'], name, { type: 'audio/wav' })
const imageFile = (name: string) =>
  new File(['not-a-real-image'], name, { type: 'image/jpeg' })

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    driveOperations.importSoundscape.mockReset()
    driveOperations.publishSoundscape.mockReset()
  })

  it('shows the private empty state initially', () => {
    render(<App engine={createMockEngine()} />)
    expect(screen.getByText('Your soundscape is empty')).toBeInTheDocument()
    expect(
      screen.getByText(/unless you explicitly export.*Google Drive/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Unsaved files are forgotten/i)).toBeInTheDocument()
  })

  it('adds a Drive import to Saved soundscapes immediately', async () => {
    const user = userEvent.setup()
    const imported: SoundscapeManifest = {
      version: 1,
      id: 'imported-id',
      name: 'Soundscape 2',
      updatedAt: '2026-08-16T00:00:00.000Z',
      masterVolume: 1,
      tracks: []
    }
    driveOperations.importSoundscape.mockResolvedValue({
      manifest: imported,
      files: new Map()
    })
    vi.spyOn(LocalSoundscapeStore.prototype, 'list')
      .mockResolvedValueOnce([])
      .mockResolvedValue([imported])
    const driveAuth: GoogleDriveAuth = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getAccessToken: vi.fn().mockReturnValue('token'),
      isConnected: vi.fn().mockReturnValue(true)
    }
    render(<App engine={createMockEngine()} driveAuth={driveAuth} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(
      screen.getByRole('button', {
        name: 'Import soundscape from Google Drive'
      })
    )
    await user.click(
      screen.getByRole('button', { name: 'Pick saved Drive soundscape' })
    )

    expect(
      await screen.findByRole('button', { name: 'Open Soundscape 2' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Restored “Soundscape 2” from Google Drive.')
    ).toBeInTheDocument()
  })

  it('exports duplicate names with distinct manifest IDs', async () => {
    const user = userEvent.setup()
    vi.spyOn(LocalSoundscapeStore.prototype, 'list').mockResolvedValue([])
    const localSave = vi
      .spyOn(LocalSoundscapeStore.prototype, 'save')
      .mockResolvedValue(undefined)
    vi.spyOn(window, 'prompt').mockReturnValue('Shared calm')
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000011')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000012')
    driveOperations.publishSoundscape.mockResolvedValue('folder-id')
    const driveAuth: GoogleDriveAuth = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      getAccessToken: vi.fn().mockReturnValue('token'),
      isConnected: vi.fn().mockReturnValue(true)
    }
    render(<App engine={createMockEngine()} driveAuth={driveAuth} />)
    const newCopy = screen.getByRole('button', {
      name: 'Export soundscape to Google Drive'
    })

    await user.click(newCopy)
    await user.click(newCopy)

    await waitFor(() =>
      expect(driveOperations.publishSoundscape).toHaveBeenCalledTimes(2)
    )
    const published = driveOperations.publishSoundscape.mock.calls.map(
      ([manifest]) => manifest as SoundscapeManifest
    )
    expect(published.map(({ name }) => name)).toEqual([
      'Shared calm',
      'Shared calm'
    ])
    expect(new Set(published.map(({ id }) => id)).size).toBe(2)
    expect(localSave).toHaveBeenCalledTimes(2)
    expect(
      new Set(localSave.mock.calls.map(([manifest]) => manifest.id)).size
    ).toBe(2)
    expect(
      screen.getByText('Exported “Shared calm” to Google Drive.')
    ).toBeInTheDocument()
  })

  it('suggests the first unused numbered name when saving', async () => {
    const user = userEvent.setup()
    vi.spyOn(LocalSoundscapeStore.prototype, 'list').mockResolvedValue([
      { name: 'Soundscape 1' },
      { name: 'soundscape 2' }
    ] as SoundscapeManifest[])
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<App engine={createMockEngine()} />)

    await user.click(
      screen.getByRole('button', { name: 'Save on this device' })
    )

    await waitFor(() =>
      expect(prompt).toHaveBeenCalledWith('Soundscape name', 'Soundscape 3')
    )
  })

  it('preserves identity for Save changes and creates a new ID for Save as', async () => {
    const user = userEvent.setup()
    vi.spyOn(LocalSoundscapeStore.prototype, 'list').mockResolvedValue([])
    vi.spyOn(
      LocalSoundscapeStore.prototype,
      'requestPersistence'
    ).mockResolvedValue(false)
    const save = vi
      .spyOn(LocalSoundscapeStore.prototype, 'save')
      .mockResolvedValue(undefined)
    vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('Morning')
      .mockReturnValueOnce('Evening')
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    render(<App engine={createMockEngine()} />)

    await user.click(
      screen.getByRole('button', { name: 'Save on this device' })
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0][0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Morning'
    })
    expect(screen.getByText(/Current soundscape:/)).toHaveTextContent('Morning')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Morning'
    })

    await user.click(
      screen.getByRole('button', { name: 'Save as new soundscape' })
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3))
    expect(save.mock.calls[2][0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Evening'
    })
  })

  it('lists saved soundscapes and opens or deletes them independently', async () => {
    const user = userEvent.setup()
    const saved = (id: string, name: string): SoundscapeManifest => ({
      version: 1,
      id,
      name,
      updatedAt: '2026-08-16T00:00:00.000Z',
      masterVolume: 1,
      tracks: []
    })
    const first = saved('first-id', 'Soundscape 1')
    const second = saved('second-id', 'Soundscape 2')
    vi.spyOn(LocalSoundscapeStore.prototype, 'list')
      .mockResolvedValueOnce([first, second])
      .mockResolvedValue([first])
    vi.spyOn(LocalSoundscapeStore.prototype, 'restore').mockResolvedValue({
      manifest: first,
      files: new Map()
    })
    const remove = vi
      .spyOn(LocalSoundscapeStore.prototype, 'delete')
      .mockResolvedValue(undefined)
    render(<App engine={createMockEngine()} />)

    await user.click(
      await screen.findByRole('button', { name: 'Open Soundscape 1' })
    )
    expect(screen.getByText(/Current soundscape:/)).toHaveTextContent(
      'Soundscape 1'
    )

    await user.click(
      screen.getByRole('button', { name: 'Delete local copy Soundscape 2' })
    )
    expect(remove).toHaveBeenCalledWith('second-id')
    expect(
      await screen.findByText(
        'Deleted the local saved soundscape and its cached media.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/Current soundscape:/)).toHaveTextContent(
      'Soundscape 1'
    )
  })

  it('renames current and non-current saved soundscapes independently', async () => {
    const user = userEvent.setup()
    const saved = (id: string, name: string): SoundscapeManifest => ({
      version: 1,
      id,
      name,
      updatedAt: '2026-08-16T00:00:00.000Z',
      masterVolume: 1,
      tracks: []
    })
    let records = [
      saved('first-id', 'Soundscape 1'),
      saved('second-id', 'Soundscape 2')
    ]
    vi.spyOn(LocalSoundscapeStore.prototype, 'list').mockImplementation(
      async () => structuredClone(records)
    )
    vi.spyOn(LocalSoundscapeStore.prototype, 'restore').mockImplementation(
      async (id) => ({
        manifest: structuredClone(records.find((record) => record.id === id)!),
        files: new Map()
      })
    )
    vi.spyOn(LocalSoundscapeStore.prototype, 'rename').mockImplementation(
      async (id, name) => {
        records = records.map((record) =>
          record.id === id ? { ...record, name } : record
        )
        return structuredClone(records.find((record) => record.id === id)!)
      }
    )
    const prompt = vi
      .spyOn(window, 'prompt')
      .mockReturnValueOnce('Background calm')
      .mockReturnValueOnce('Morning calm')
    render(<App engine={createMockEngine()} />)

    await user.click(
      await screen.findByRole('button', { name: 'Open Soundscape 1' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Rename Soundscape 2' })
    )
    expect(
      await screen.findByRole('button', { name: 'Open Background calm' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Current soundscape:/)).toHaveTextContent(
      'Soundscape 1'
    )

    await user.click(
      screen.getByRole('button', { name: 'Rename Soundscape 1' })
    )
    expect(screen.getByText(/Current soundscape:/)).toHaveTextContent(
      'Morning calm'
    )
    expect(prompt).toHaveBeenNthCalledWith(
      1,
      'Rename soundscape',
      'Soundscape 2'
    )
  })

  it('continues restoring later tracks and the image when one saved track fails', async () => {
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack)
      .mockRejectedValueOnce(new Error('broken saved file'))
      .mockResolvedValueOnce(120)
    const manifest: SoundscapeManifest = {
      version: 1,
      id: 'saved-id',
      name: 'Saved scene',
      updatedAt: '2026-08-16T00:00:00.000Z',
      masterVolume: 0.6,
      image: {
        name: 'forest.jpg',
        mimeType: 'image/jpeg',
        size: 5,
        reference: { localPath: 'image.media' }
      },
      tracks: ['broken.wav', 'rain.wav'].map((name, index) => ({
        name,
        mimeType: 'audio/wav',
        size: 5,
        volume: 0.5,
        isSoundEffect: false,
        effectChance: 50,
        reference: { localPath: `track-${index}.media` }
      }))
    }
    vi.spyOn(LocalSoundscapeStore.prototype, 'restoreLast').mockResolvedValue({
      manifest,
      files: new Map([
        [
          'track-0.media',
          new File(['bad'], 'broken.wav', { type: 'audio/wav' })
        ],
        [
          'track-1.media',
          new File(['rain'], 'rain.wav', { type: 'audio/wav' })
        ],
        [
          'image.media',
          new File(['image'], 'forest.jpg', { type: 'image/jpeg' })
        ]
      ])
    })

    render(<App engine={engine} />)

    expect(
      await screen.findByText('This audio file could not be read or decoded.')
    ).toBeInTheDocument()
    expect(await screen.findByText('rain.wav')).toBeInTheDocument()
    expect(await screen.findByText('forest.jpg')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledTimes(2)
  })

  it('reuses restored OPFS paths when saving changes repeatedly', async () => {
    const user = userEvent.setup()
    const manifest: SoundscapeManifest = {
      version: 1,
      id: 'drive-cache-id',
      name: 'Drive import',
      updatedAt: '2026-08-16T00:00:00.000Z',
      masterVolume: 1,
      image: {
        name: 'forest.jpg',
        mimeType: 'image/jpeg',
        size: 5,
        reference: { localPath: 'cached-image.media' }
      },
      tracks: [
        {
          name: 'rain.wav',
          mimeType: 'audio/wav',
          size: 5,
          volume: 1,
          isSoundEffect: false,
          effectChance: 50,
          reference: {
            localPath: 'cached-rain.media',
            driveFileId: 'drive-rain'
          }
        }
      ]
    }
    vi.spyOn(LocalSoundscapeStore.prototype, 'restoreLast').mockResolvedValue({
      manifest,
      files: new Map([
        [
          'cached-rain.media',
          new File(['rain'], 'rain.wav', { type: 'audio/wav' })
        ],
        [
          'cached-image.media',
          new File(['image'], 'forest.jpg', { type: 'image/jpeg' })
        ]
      ])
    })
    vi.spyOn(LocalSoundscapeStore.prototype, 'list').mockResolvedValue([
      manifest
    ])
    const save = vi
      .spyOn(LocalSoundscapeStore.prototype, 'save')
      .mockResolvedValue(undefined)
    render(<App engine={createMockEngine()} />)
    await screen.findByText('rain.wav')

    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(save).toHaveBeenCalledTimes(2)
    for (const [savedManifest, newFiles] of save.mock.calls) {
      expect(savedManifest.tracks[0].reference.localPath).toBe(
        'cached-rain.media'
      )
      expect(savedManifest.image?.reference.localPath).toBe(
        'cached-image.media'
      )
      expect(newFiles.size).toBe(0)
    }
  })

  it('loads multiple selected audio files and removes a track', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    const input = document.querySelector<HTMLInputElement>('#audio-files')!
    await user.upload(input, [audioFile('rain.wav'), audioFile('birds.wav')])
    expect(await screen.findByText('rain.wav')).toBeInTheDocument()
    expect(screen.getByText('birds.wav')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledTimes(2)
    expect(engine.setTrackLoop).toHaveBeenNthCalledWith(1, 'track-0', true)
    expect(engine.setTrackLoop).toHaveBeenNthCalledWith(2, 'track-1', true)
    await user.click(screen.getByRole('button', { name: 'Remove rain.wav' }))
    expect(screen.queryByText('rain.wav')).not.toBeInTheDocument()
    expect(engine.removeTrack).toHaveBeenCalledWith('track-0')
  })

  it('adds one image and shows it by itself in theater mode', async () => {
    const user = userEvent.setup()
    render(<App engine={createMockEngine()} />)

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      imageFile('forest.jpg')
    )
    expect(screen.getByText('forest.jpg')).toBeInTheDocument()
    expect(screen.getByAltText('Soundscape visual')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Theater mode' }))
    const viewer = screen.getByRole('dialog', {
      name: /Soundscape image viewer/
    })
    expect(viewer).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exit view' })).toBeNull()
    await user.click(viewer.querySelector('img')!)
    expect(
      screen.queryByRole('dialog', { name: /Soundscape image viewer/ })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Theater mode' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: /Soundscape image viewer/ })
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('forest.jpg')).not.toBeInTheDocument()
  })

  it('sorts audio and image files selected through the same upload control', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      [audioFile('rain.wav'), imageFile('forest.jpg'), audioFile('birds.wav')]
    )

    expect(await screen.findByText('rain.wav')).toBeInTheDocument()
    expect(screen.getByText('birds.wav')).toBeInTheDocument()
    expect(screen.getByText('forest.jpg')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledTimes(2)
  })

  it('updates per-track and master volume', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      audioFile('ocean.wav')
    )
    const trackVolume = await screen.findByLabelText('Volume for ocean.wav')
    fireEvent.change(trackVolume, { target: { value: '0.02' } })
    expect(engine.setTrackVolume).toHaveBeenLastCalledWith('track-0', 0.02)
    const master = screen.getByLabelText('Master volume')
    fireEvent.change(master, { target: { value: '0.01' } })
    expect(engine.setMasterVolume).toHaveBeenLastCalledWith(0.01)
    expect(screen.getByText('1%')).toBeInTheDocument()
  })

  it('shows errors for unsupported and unreadable files', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockRejectedValueOnce(
      new Error('decode failed')
    )
    render(<App engine={engine} />)
    const input = document.querySelector<HTMLInputElement>('#audio-files')!
    await user.upload(
      input,
      new File(['text'], 'notes.txt', { type: 'text/plain' })
    )
    expect(
      await screen.findByText('Unsupported file type.')
    ).toBeInTheDocument()
    await user.upload(input, audioFile('broken.wav'))
    expect(
      await screen.findByText('This audio file could not be read or decoded.')
    ).toBeInTheDocument()
  })

  it.each([
    ['an empty MIME type', ''],
    ['a generic MIME type', 'application/octet-stream'],
    ['an Ogg application MIME type', 'application/ogg']
  ])('loads an Opus candidate with %s', async (_description, type) => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    render(<App engine={engine} />)
    const file = new File(['opus-candidate'], 'meditation.opus', { type })

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      file
    )

    expect(await screen.findByText('meditation.opus')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledWith('track-0', file)
  })

  it('loads an extensionless candidate with a generic MIME type', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    render(<App engine={engine} />)
    const file = new File(['audio-candidate'], 'provider-download', {
      type: 'application/octet-stream'
    })

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      file
    )

    expect(await screen.findByText('provider-download')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledWith('track-0', file)
  })

  it('uses a known audio extension as a positive hint over a non-audio MIME type', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    render(<App engine={engine} />)
    const file = new File(['opus-candidate'], 'meditation.opus', {
      type: 'text/plain'
    })

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      file
    )

    expect(await screen.findByText('meditation.opus')).toBeInTheDocument()
    expect(engine.loadTrack).toHaveBeenCalledWith('track-0', file)
  })

  it('rejects ordinary non-audio input without attempting playback metadata', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    render(<App engine={engine} />)

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      new File(['text'], 'notes.txt', { type: 'text/plain' })
    )

    expect(
      await screen.findByText('Unsupported file type.')
    ).toBeInTheDocument()
    expect(engine.loadTrack).not.toHaveBeenCalled()
  })

  it('reports a backend load failure for an Opus candidate as unreadable audio', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockRejectedValueOnce(
      new Error('media element failed to load metadata')
    )
    render(<App engine={engine} />)
    const file = new File(['unsupported-bytes'], 'broken.opus', { type: '' })

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      file
    )

    expect(engine.loadTrack).toHaveBeenCalledWith('track-0', file)
    expect(
      await screen.findByText('This audio file could not be read or decoded.')
    ).toBeInTheDocument()
  })

  it('shows an unsupported-format error reported by media metadata loading', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockRejectedValueOnce(
      new AudioEngineLoadError('unsupported-media', 'unsupported')
    )
    render(<App engine={engine} />)

    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      audioFile('unsupported.wav')
    )
    expect(
      await screen.findByText('Unsupported audio format.')
    ).toBeInTheDocument()
  })

  it('plays, pauses, and controls all ready tracks through the engine', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      audioFile('rain.wav')
    )
    const play = await screen.findByRole('button', { name: 'Play rain.wav' })
    await user.click(play)
    expect(engine.play).toHaveBeenCalledWith('track-0')
    await user.click(screen.getByRole('button', { name: 'Pause rain.wav' }))
    expect(engine.pause).toHaveBeenCalledWith('track-0')
    await user.click(screen.getByRole('button', { name: /Play All/ }))
    expect(engine.playAll).toHaveBeenCalledWith(['track-0'])
    await user.click(screen.getByRole('button', { name: /Stop All/ }))
    expect(engine.stopAll).toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Play rain.wav' })
      ).toBeInTheDocument()
    )
  })

  it('enables random sound effects with Play All and disables them with Stop All', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockResolvedValueOnce(5)
    render(<App engine={engine} />)
    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      audioFile('bell.wav')
    )

    expect(
      screen.getByText('Sound effect · random playback disabled')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Play All/ }))
    expect(
      screen.getByText('Sound effect · random playback enabled')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Stop All/ }))
    expect(
      screen.getByText('Sound effect · random playback disabled')
    ).toBeInTheDocument()
    expect(engine.stopAll).toHaveBeenCalled()
  })

  it('starts, pauses, resumes, and resets a count-up meditation', async () => {
    vi.useFakeTimers()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    fireEvent.change(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      { target: { files: [audioFile('rain.wav')] } }
    )
    await act(async () => {})

    const start = screen.getByRole('button', { name: /Start Meditation/ })
    fireEvent.click(start)
    expect(engine.playAll).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(screen.getByText('00:05')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ⅱ Pause' }))
    expect(engine.pause).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByText('00:05')).toBeInTheDocument()

    fireEvent.click(start)
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(screen.getByText('00:07')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
    expect(screen.getByText('00:00')).toBeInTheDocument()
  })

  it('counts down for the selected duration without controlling audio', async () => {
    vi.useFakeTimers()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    fireEvent.change(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      { target: { files: [audioFile('rain.wav')] } }
    )
    await act(async () => {})

    fireEvent.change(screen.getByLabelText('Timer type'), {
      target: { value: 'countdown' }
    })
    fireEvent.change(screen.getByLabelText('Minutes'), {
      target: { value: '1' }
    })
    expect(screen.getByText('01:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Start Meditation/ }))
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('Meditation completed')).toBeInTheDocument()
    expect(engine.playAll).not.toHaveBeenCalled()
    expect(engine.pause).not.toHaveBeenCalled()
    expect(engine.stopAll).toHaveBeenCalledOnce()
    expect(engine.prepareCompletionGong).toHaveBeenCalled()
    expect(engine.playCompletionGong).toHaveBeenCalled()
    expect(vi.mocked(engine.stopAll)).toHaveBeenCalledBefore(
      vi.mocked(engine.playCompletionGong)
    )
    expect(screen.getByRole('button', { name: 'Ⅱ Pause' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))
    expect(screen.queryByText('Meditation completed')).not.toBeInTheDocument()
  })

  it('blacks out an open image viewer when a countdown completes', async () => {
    vi.useFakeTimers()
    render(<App engine={createMockEngine()} />)
    fireEvent.change(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      { target: { files: [imageFile('forest.jpg')] } }
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Theater mode' }))
    expect(screen.getByRole('dialog').querySelector('img')).not.toBeNull()

    fireEvent.change(screen.getByLabelText('Timer type'), {
      target: { value: 'countdown' }
    })
    fireEvent.change(screen.getByLabelText('Minutes'), {
      target: { value: '1' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Start Meditation/ }))
    await act(() => vi.advanceTimersByTimeAsync(60_000))

    const blackout = screen.getByRole('dialog', {
      name: /Meditation completed/
    })
    expect(blackout).toHaveClass('image-viewer-complete')
    expect(blackout.querySelector('img')).toBeNull()
    expect(screen.getByText('meditation complete')).toBeInTheDocument()
    fireEvent.click(blackout)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports gong failures without preventing countdown completion', async () => {
    vi.useFakeTimers()
    const engine = createMockEngine()
    const prepareError = new Error('gong load failed')
    const playbackError = new Error('gong playback failed')
    vi.mocked(engine.prepareCompletionGong).mockRejectedValue(prepareError)
    vi.mocked(engine.playCompletionGong).mockRejectedValue(playbackError)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App engine={engine} />)

    fireEvent.change(screen.getByLabelText('Timer type'), {
      target: { value: 'countdown' }
    })
    fireEvent.change(screen.getByLabelText('Minutes'), {
      target: { value: '1' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Start Meditation/ }))
    await act(async () => {})

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to prepare the completion gong.',
      prepareError
    )

    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(screen.getByText('Meditation completed')).toBeInTheDocument()
    expect(engine.stopAll).toHaveBeenCalledOnce()
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to play the completion gong.',
      playbackError
    )
  })

  it('optionally starts audio and full screens the image with meditation', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      [audioFile('rain.wav'), imageFile('forest.jpg')]
    )

    await user.click(
      screen.getByLabelText(
        'Play all audio and full screen the image when meditation starts'
      )
    )
    await user.click(screen.getByRole('button', { name: /Start Meditation/ }))

    expect(engine.playAll).toHaveBeenCalledWith(['track-0'])
    expect(
      screen.getByRole('dialog', { name: /Soundscape image viewer/ })
    ).toBeInTheDocument()
  })

  it('reflects natural completion and rejected playback promises', async () => {
    const user = userEvent.setup()
    const engine = createMockEngine()
    render(<App engine={engine} />)
    await user.upload(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      audioFile('rain.wav')
    )

    await user.click(
      await screen.findByRole('button', { name: 'Play rain.wav' })
    )
    expect(
      screen.getByRole('button', { name: 'Pause rain.wav' })
    ).toBeInTheDocument()
    act(() => engine.emit({ id: 'track-0', state: 'ended' }))
    expect(
      screen.getByRole('button', { name: 'Play rain.wav' })
    ).toBeInTheDocument()

    vi.mocked(engine.play).mockRejectedValueOnce(new Error('blocked'))
    await user.click(screen.getByRole('button', { name: 'Play rain.wav' }))
    expect(
      screen.getByRole('button', { name: 'Play rain.wav' })
    ).toBeInTheDocument()
  })

  it('classifies short audio and configures its random playback chance', async () => {
    vi.useFakeTimers()
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockResolvedValue(10)
    render(<App engine={engine} />)

    fireEvent.change(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      { target: { files: [audioFile('bell.wav')] } }
    )
    await act(async () => {})
    expect(
      screen.getByText('Sound effect · random playback disabled')
    ).toBeInTheDocument()
    expect(engine.setTrackLoop).toHaveBeenCalledWith('track-0', false)
    const chance = screen.getByLabelText(/Play chance each second/)
    expect(chance).toHaveValue(50)
    fireEvent.change(chance, { target: { value: '25' } })
    expect(chance).toHaveValue(25)

    fireEvent.click(screen.getByRole('button', { name: 'Enable bell.wav' }))
    expect(
      screen.getByText('Sound effect · random playback enabled')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Disable bell.wav' })
    ).toBeInTheDocument()
  })

  it.each([
    { chance: 50, expectedIntervalSeconds: 60 },
    { chance: 25, expectedIntervalSeconds: 35 }
  ])(
    'plays a 1 in $chance effect at its intended long-run frequency',
    async ({ chance, expectedIntervalSeconds }) => {
      vi.useFakeTimers()
      const engine = createMockEngine()
      vi.mocked(engine.loadTrack).mockResolvedValue(10)
      let randomCalls = 0
      const random = vi.spyOn(Math, 'random').mockImplementation(() => {
        randomCalls += 1
        return randomCalls % chance === 0 ? 0 : 0.5
      })
      render(<App engine={engine} />)

      fireEvent.change(
        document.querySelector<HTMLInputElement>('#audio-files')!,
        { target: { files: [audioFile('bell.wav')] } }
      )
      await act(async () => {})
      fireEvent.change(screen.getByLabelText(/Play chance each second/), {
        target: { value: String(chance) }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Enable bell.wav' }))

      await vi.advanceTimersByTimeAsync((chance - 1) * 1000)
      expect(engine.play).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1000)
      expect(engine.play).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync((expectedIntervalSeconds - 1) * 1000)
      expect(engine.play).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(engine.play).toHaveBeenCalledTimes(2)
      expect(random).toHaveBeenCalledTimes(chance * 2)
    }
  )
})
