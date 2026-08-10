import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngineLoadError } from './types'
import { WebAudioEngine } from './WebAudioEngine'

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeGain extends FakeNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn()
  }
}

class FakeMediaSource extends FakeNode {}

class FakeOscillator extends FakeNode {
  type: OscillatorType = 'sine'
  frequency = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn()
  }
  start = vi.fn()
  stop = vi.fn()
  addEventListener = vi.fn((_name: string, listener: EventListener) => {
    this.ended = listener
  })
  ended: EventListener | null = null
}

class FakeContext {
  state: AudioContextState = 'suspended'
  destination = new FakeNode()
  currentTime = 4
  gainNodes: FakeGain[] = []
  mediaSources: FakeMediaSource[] = []
  oscillators: FakeOscillator[] = []
  createGain = vi.fn(() => {
    const node = new FakeGain()
    this.gainNodes.push(node)
    return node
  })
  createMediaElementSource = vi.fn(() => {
    const node = new FakeMediaSource()
    this.mediaSources.push(node)
    return node
  })
  createOscillator = vi.fn(() => {
    const node = new FakeOscillator()
    this.oscillators.push(node)
    return node
  })
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []
  preload = ''
  src = ''
  duration = Number.NaN
  currentTime = 0
  ended = false
  loop = false
  error: MediaError | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
  load = vi.fn()
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = ''
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

describe('WebAudioEngine', () => {
  let context: FakeContext
  const createObjectURL = vi.fn(() => 'blob:track')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    context = new FakeContext()
    FakeAudio.instances = []
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    function MockAudioContext() {
      return context
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext
    })
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  })

  it('loads metadata from object URLs and connects each media element once', async () => {
    const engine = new WebAudioEngine()
    const file = new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    const loading = engine.loadTrack('rain', file)
    const audio = FakeAudio.instances[0]

    expect(createObjectURL).toHaveBeenCalledWith(file)
    expect(audio.preload).toBe('metadata')
    expect(audio.src).toBe('blob:track')
    expect(audio.load).toHaveBeenCalledOnce()
    audio.metadata(20)

    expect(await loading).toBe(20)
    expect(context.createMediaElementSource).toHaveBeenCalledWith(audio)
    expect(context.gainNodes).toHaveLength(2)
    expect(context.mediaSources[0].connect).toHaveBeenCalledWith(
      context.gainNodes[1]
    )
    expect(context.gainNodes[1].connect).toHaveBeenCalledWith(
      context.gainNodes[0]
    )

    engine.setTrackLoop('rain', true)
    expect(audio.loop).toBe(true)
  })

  it('prepares and plays a shaped cue on its shared context, then cleans up', async () => {
    const engine = new WebAudioEngine()
    await engine.prepareTimerCue()
    await engine.playTimerCue()

    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.oscillators).toHaveLength(1)
    expect(context.gainNodes).toHaveLength(2)
    const oscillator = context.oscillators[0]
    const cueGain = context.gainNodes[1]
    expect(cueGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 4)
    expect(cueGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0.09,
      4.04
    )
    expect(cueGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(
      0.0001,
      5.2
    )
    expect(oscillator.start).toHaveBeenCalledWith(4)
    expect(oscillator.stop).toHaveBeenCalledWith(5.2)
    oscillator.ended?.(new Event('ended'))
    expect(oscillator.disconnect).toHaveBeenCalledOnce()
    expect(cueGain.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps visual fallback callers safe when Web Audio is unsupported', async () => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: undefined
    })
    const engine = new WebAudioEngine()

    await expect(engine.prepareTimerCue()).resolves.toBeUndefined()
    await expect(engine.playTimerCue()).resolves.toBeUndefined()
  })

  it('uses media element transport and releases resources', async () => {
    const engine = new WebAudioEngine()
    const listener = vi.fn()
    engine.subscribe(listener)
    const file = new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    const firstLoad = engine.loadTrack('rain', file)
    const rain = FakeAudio.instances[0]
    rain.metadata(20)
    await firstLoad
    const secondLoad = engine.loadTrack('wind', file)
    const wind = FakeAudio.instances[1]
    wind.metadata(30)
    await secondLoad

    await engine.playAll(['rain', 'wind'])
    expect(context.resume).toHaveBeenCalledOnce()
    expect(rain.play).toHaveBeenCalledOnce()
    expect(wind.play).toHaveBeenCalledOnce()
    rain.dispatchEvent(new Event('play'))
    expect(listener).toHaveBeenLastCalledWith({ id: 'rain', state: 'playing' })
    rain.currentTime = 8
    engine.pause('rain')
    rain.dispatchEvent(new Event('pause'))
    expect(rain.pause).toHaveBeenCalledOnce()
    expect(rain.currentTime).toBe(8)
    expect(listener).toHaveBeenLastCalledWith({ id: 'rain', state: 'paused' })
    rain.dispatchEvent(new Event('ended'))
    expect(listener).toHaveBeenLastCalledWith({ id: 'rain', state: 'ended' })
    wind.dispatchEvent(new Event('error'))
    expect(listener).toHaveBeenLastCalledWith({ id: 'wind', state: 'error' })
    engine.stopAll()
    expect(rain.currentTime).toBe(0)
    expect(wind.currentTime).toBe(0)

    engine.removeTrack('rain')
    expect(rain.removeAttribute).toHaveBeenCalledWith('src')
    listener.mockClear()
    rain.dispatchEvent(new Event('play'))
    expect(listener).not.toHaveBeenCalled()
    expect(context.mediaSources[0].disconnect).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track')
    await engine.dispose()
    expect(wind.removeAttribute).toHaveBeenCalledWith('src')
    expect(context.close).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('categorizes media errors and revokes failed object URLs', async () => {
    const engine = new WebAudioEngine()
    const loading = engine.loadTrack(
      'broken',
      new File(['bad'], 'broken.wav', { type: 'audio/wav' })
    )
    const audio = FakeAudio.instances[0]
    audio.error = { code: 4 } as MediaError
    audio.dispatchEvent(new Event('error'))

    await expect(loading).rejects.toMatchObject({
      category: 'unsupported-media'
    } satisfies Partial<AudioEngineLoadError>)
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.src).toBe('')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:track')
  })

  it('cancels pending loads without allowing late metadata to add a track', async () => {
    const engine = new WebAudioEngine()
    const loading = engine.loadTrack(
      'rain',
      new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    )
    const audio = FakeAudio.instances[0]
    engine.removeTrack('rain')
    audio.metadata(20)

    await expect(loading).rejects.toMatchObject({
      category: 'metadata-read-failure'
    })
    expect(context.createMediaElementSource).not.toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })
})
