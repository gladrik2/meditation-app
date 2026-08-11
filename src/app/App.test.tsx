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
