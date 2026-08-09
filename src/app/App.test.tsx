import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockEngine } from '../test/mockEngine'
import { AudioEngineLoadError } from '../audio/types'
import { App } from './App'

const audioFile = (name: string) =>
  new File(['not-real-audio'], name, { type: 'audio/wav' })
const imageFile = (name: string) =>
  new File(['not-a-real-image'], name, { type: 'image/jpeg' })

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the private empty state initially', () => {
    render(<App engine={createMockEngine()} />)
    expect(screen.getByText('Your soundscape is empty')).toBeInTheDocument()
    expect(
      screen.getByText(/your files never leave your device/i)
    ).toBeInTheDocument()
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

  it('classifies short audio and plays it by chance with a ten-second cooldown', async () => {
    vi.useFakeTimers()
    const engine = createMockEngine()
    vi.mocked(engine.loadTrack).mockResolvedValue(10)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    render(<App engine={engine} />)

    fireEvent.change(
      document.querySelector<HTMLInputElement>('#audio-files')!,
      { target: { files: [audioFile('bell.wav')] } }
    )
    await act(async () => {})
    expect(
      screen.getByText('Sound effect · random playback disabled')
    ).toBeInTheDocument()
    const chance = screen.getByLabelText(/Play chance each second/)
    expect(chance).toHaveValue(50)
    fireEvent.change(chance, { target: { value: '25' } })
    expect(chance).toHaveValue(25)

    fireEvent.click(screen.getByRole('button', { name: 'Enable bell.wav' }))
    expect(
      screen.getByText('Sound effect · random playback enabled')
    ).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(1000)
    expect(engine.play).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9000)
    expect(engine.play).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(engine.play).toHaveBeenCalledTimes(2)
    act(() => engine.emit({ id: 'track-0', state: 'ended' }))
    expect(
      screen.getByRole('button', { name: 'Disable bell.wav' })
    ).toBeInTheDocument()
  })
})
