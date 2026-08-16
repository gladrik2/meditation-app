import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HowlerAudioEngine } from './HowlerAudioEngine'

const howler = vi.hoisted(() => {
  class FakeHowl {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>()
    stateValue = 'loading'
    loopValue = false
    nextSoundId = 1
    play = vi.fn((soundId?: number) => soundId ?? this.nextSoundId++)
    pause = vi.fn((soundId: number) => this.fire('pause', soundId))
    stop = vi.fn((soundId: number) => this.fire('stop', soundId))
    unload = vi.fn()
    loop = vi.fn((valueOrId?: boolean | number) => {
      if (typeof valueOrId === 'boolean') {
        this.loopValue = valueOrId
        return this
      }
      return this.loopValue
    })
    volume = vi.fn()
    fade = vi.fn()
    playing = vi.fn(() => false)

    constructor(public options: Record<string, unknown>) {
      instances.push(this)
    }

    once(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
      return this
    }

    state() {
      return this.stateValue
    }

    fire(event: string, ...args: unknown[]) {
      const configured = this.options[`on${event}`]
      if (typeof configured === 'function') configured(...args)
      const handlers = this.handlers.get(event) ?? []
      this.handlers.delete(event)
      for (const handler of handlers) handler(...args)
    }
  }
  const instances: FakeHowl[] = []
  return { instances, FakeHowl }
})

vi.mock('howler', () => ({ Howl: howler.FakeHowl }))

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []
  preload = ''
  src = ''
  duration = Number.NaN
  error: MediaError | null = null
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn(() => {
    this.src = ''
  })

  constructor() {
    super()
    FakeAudio.instances.push(this)
  }

  metadata(duration: number) {
    this.duration = duration
    this.dispatchEvent(new Event('loadedmetadata'))
  }
}

describe('HowlerAudioEngine', () => {
  const createObjectURL = vi.fn(() => 'blob:track')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    howler.instances.length = 0
    FakeAudio.instances.length = 0
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  })

  const finishLoad = async (duration: number, name = 'track.ogg') => {
    const engine = new HowlerAudioEngine()
    const loading = engine.loadTrack(
      'track',
      new File(['audio'], name, { type: 'audio/ogg' })
    )
    FakeAudio.instances[0].metadata(duration)
    const howl = howler.instances[0]
    howl.stateValue = 'loaded'
    howl.fire('load')
    expect(await loading).toBe(duration)
    return { engine, howl }
  }

  it('streams long tracks with HTML5 Audio', async () => {
    const { engine, howl } = await finishLoad(120)

    expect(howl.options).toMatchObject({
      src: ['blob:track'],
      format: ['ogg'],
      html5: true,
      preload: true
    })
    engine.setTrackLoop('track', true)
    engine.setTrackVolume('track', 0.5)
    engine.setMasterVolume(0.4)
    expect(howl.loop).toHaveBeenCalledWith(true)
    expect(howl.volume).not.toHaveBeenCalledWith(0.2, expect.anything())
  })

  it('ignores internal storage suffixes and uses the audio MIME format', async () => {
    const { howl } = await finishLoad(
      120,
      'track-0-meditation.wav.random.media'
    )

    expect(howl.options.format).toEqual(['ogg'])
  })

  it('times out a track that never finishes metadata loading', async () => {
    vi.useFakeTimers()
    const engine = new HowlerAudioEngine()
    const loading = engine.loadTrack(
      'stuck-track',
      new File(['bad'], 'broken.wav', { type: 'audio/wav' })
    )
    const timedOut = expect(loading).rejects.toThrow(/too long to load/i)

    await vi.advanceTimersByTimeAsync(15_000)

    await timedOut
    vi.useRealTimers()
  })

  it('uses normal Howler Web Audio playback for short effects and the gong', async () => {
    const { engine, howl } = await finishLoad(4)
    expect(howl.options.html5).toBe(false)

    const gongLoading = engine.prepareCompletionGong()
    const gong = howler.instances[1]
    expect(gong.options).toMatchObject({ html5: false, format: ['ogg'] })
    gong.fire('load')
    await gongLoading
    await engine.playCompletionGong()
    expect(gong.play).toHaveBeenCalledOnce()
  })

  it('preserves transport events and releases local object URLs', async () => {
    const { engine, howl } = await finishLoad(30)
    const listener = vi.fn()
    engine.subscribe(listener)

    const playing = engine.play('track')
    howl.fire('play', 1)
    await playing
    expect(listener).toHaveBeenLastCalledWith({
      id: 'track',
      state: 'playing'
    })
    engine.pause('track')
    expect(howl.pause).toHaveBeenCalledWith(1)
    expect(listener).toHaveBeenLastCalledWith({ id: 'track', state: 'paused' })
    engine.removeTrack('track')
    expect(howl.unload).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track')
  })

  it('reuses the sound ID and fades in new playback and resume', async () => {
    const { engine, howl } = await finishLoad(30)
    engine.setTrackVolume('track', 0.5)
    engine.setMasterVolume(0.4)

    const firstPlay = engine.play('track')
    howl.fire('play', 1)
    await firstPlay
    expect(howl.play).toHaveBeenNthCalledWith(1, undefined)
    expect(howl.volume).toHaveBeenCalledWith(0, 1)
    expect(howl.fade).toHaveBeenCalledWith(0, 0.2, 20, 1)

    engine.pause('track')
    howl.volume.mockClear()
    howl.fade.mockClear()
    const resumed = engine.play('track')
    howl.fire('play', 1)
    await resumed
    expect(howl.play).toHaveBeenNthCalledWith(2, 1)
    expect(howl.volume).toHaveBeenCalledWith(0, 1)
    expect(howl.fade).toHaveBeenCalledWith(0, 0.2, 20, 1)
  })

  it('leaves an already-playing track unchanged when played again', async () => {
    const { engine, howl } = await finishLoad(30)
    const firstPlay = engine.play('track')
    howl.playing.mockReturnValue(true)
    howl.fire('play', 1)
    await firstPlay
    howl.play.mockClear()
    howl.volume.mockClear()

    void engine.playAll(['track'])

    expect(howl.play).not.toHaveBeenCalled()
    expect(howl.volume).not.toHaveBeenCalled()
  })

  it('coalesces repeated play requests while playback is starting', async () => {
    const { engine, howl } = await finishLoad(30)

    const firstPlay = engine.playAll(['track'])
    const secondPlay = engine.playAll(['track'])

    expect(howl.play).toHaveBeenCalledOnce()
    howl.fire('play', 1)
    await Promise.all([firstPlay, secondPlay])
  })

  it('keeps a looping long track controllable after an end event', async () => {
    const { engine, howl } = await finishLoad(120)
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.setTrackLoop('track', true)

    const playing = engine.play('track')
    howl.fire('play', 1)
    await playing
    howl.fire('end', 1)
    engine.pause('track')

    expect(howl.pause).toHaveBeenCalledWith(1)
    expect(listener).not.toHaveBeenCalledWith({ id: 'track', state: 'ended' })
  })

  it('applies the startup fade to short sound effects', async () => {
    const { engine, howl } = await finishLoad(4)

    const playing = engine.play('track')
    howl.fire('play', 1)
    await playing

    expect(howl.options.html5).toBe(false)
    expect(howl.volume).toHaveBeenCalledWith(0, 1)
    expect(howl.fade).toHaveBeenCalledWith(0, 1, 20, 1)
  })
})
