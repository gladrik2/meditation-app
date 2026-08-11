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
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn()
  }
}

class FakeCompressor extends FakeNode {
  threshold = { value: 0 }
  knee = { value: 0 }
  ratio = { value: 0 }
  attack = { value: 0 }
  release = { value: 0 }
}

class FakeMediaSource extends FakeNode {}

class FakeBufferSource extends EventTarget {
  buffer: AudioBuffer | null = null
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

class FakeContext {
  state: AudioContextState = 'suspended'
  destination = new FakeNode()
  currentTime = 12
  gainNodes: FakeGain[] = []
  compressors: FakeCompressor[] = []
  mediaSources: FakeMediaSource[] = []
  bufferSources: FakeBufferSource[] = []
  createGain = vi.fn(() => {
    const node = new FakeGain()
    this.gainNodes.push(node)
    return node
  })
  createDynamicsCompressor = vi.fn(() => {
    const node = new FakeCompressor()
    this.compressors.push(node)
    return node
  })
  createMediaElementSource = vi.fn(() => {
    const node = new FakeMediaSource()
    this.mediaSources.push(node)
    return node
  })
  createBufferSource = vi.fn(() => {
    const node = new FakeBufferSource()
    this.bufferSources.push(node)
    return node
  })
  decodeAudioData = vi.fn(async () => ({ duration: 2 }) as AudioBuffer)
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

  constructor(src = '') {
    super()
    this.src = src
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
  const gongBytes = new ArrayBuffer(8)
  const fetchGong = vi.fn(async () =>
    Promise.resolve({
      ok: true,
      arrayBuffer: async () => gongBytes
    } as Response)
  )

  beforeEach(() => {
    context = new FakeContext()
    FakeAudio.instances = []
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    fetchGong.mockClear()
    function MockAudioContext() {
      return context
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext
    })
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('fetch', fetchGong)
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
    expect(context.gainNodes).toHaveLength(3)
    expect(context.mediaSources[0].connect).toHaveBeenCalledWith(
      context.gainNodes[2]
    )
    expect(context.gainNodes[2].connect).toHaveBeenCalledWith(
      context.gainNodes[1]
    )
    expect(context.gainNodes[1].connect).toHaveBeenCalledWith(
      context.gainNodes[0]
    )

    engine.setTrackLoop('rain', true)
    expect(audio.loop).toBe(true)
  })

  it('fades starts in independently of the per-track volume', async () => {
    const engine = new WebAudioEngine()
    const loading = engine.loadTrack(
      'rain',
      new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    )
    FakeAudio.instances[0].metadata(20)
    await loading

    engine.setTrackVolume('rain', 0.4)
    const volumeGain = context.gainNodes[1]
    const startGain = context.gainNodes[2]
    let resolvePlay!: () => void
    FakeAudio.instances[0].play.mockImplementation(
      () => new Promise<void>((resolve) => (resolvePlay = resolve))
    )

    const playing = engine.play('rain')
    await vi.waitFor(() =>
      expect(FakeAudio.instances[0].play).toHaveBeenCalled()
    )

    expect(startGain.gain.cancelScheduledValues).toHaveBeenCalledWith(12)
    expect(startGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 12)
    expect(startGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    context.currentTime = 14
    resolvePlay()
    await playing

    expect(startGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      14.005
    )
    expect(volumeGain.gain.value).toBe(0.4)
  })

  it('keeps every play-all track muted until its playback starts', async () => {
    const engine = new WebAudioEngine()
    const file = new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    const rainLoading = engine.loadTrack('rain', file)
    const rain = FakeAudio.instances[0]
    rain.metadata(20)
    await rainLoading
    const windLoading = engine.loadTrack('wind', file)
    const wind = FakeAudio.instances[1]
    wind.metadata(30)
    await windLoading
    let resolveRain!: () => void
    let resolveWind!: () => void
    rain.play.mockImplementation(
      () => new Promise<void>((resolve) => (resolveRain = resolve))
    )
    wind.play.mockImplementation(
      () => new Promise<void>((resolve) => (resolveWind = resolve))
    )

    const playing = engine.playAll(['rain', 'wind'])
    await vi.waitFor(() => {
      expect(rain.play).toHaveBeenCalled()
      expect(wind.play).toHaveBeenCalled()
    })
    const rainStartGain = context.gainNodes[2]
    const windStartGain = context.gainNodes[4]
    expect(rainStartGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 12)
    expect(windStartGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 12)
    expect(rainStartGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    expect(windStartGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()

    context.currentTime = 15
    resolveRain()
    await vi.waitFor(() =>
      expect(rainStartGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
        1,
        15.005
      )
    )
    expect(windStartGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
    context.currentTime = 16
    resolveWind()
    await playing
    expect(windStartGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      1,
      16.005
    )
  })

  it('restores start gain when playback is rejected', async () => {
    const engine = new WebAudioEngine()
    const loading = engine.loadTrack(
      'rain',
      new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    )
    const rain = FakeAudio.instances[0]
    rain.metadata(20)
    await loading
    rain.play.mockImplementation(async () => {
      context.currentTime = 13
      throw new Error('Playback was blocked.')
    })

    await expect(engine.play('rain')).rejects.toThrow('Playback was blocked.')

    const startGain = context.gainNodes[2]
    expect(startGain.gain.setValueAtTime).toHaveBeenNthCalledWith(1, 0, 12)
    expect(startGain.gain.setValueAtTime).toHaveBeenNthCalledWith(2, 1, 13)
    expect(startGain.gain.linearRampToValueAtTime).not.toHaveBeenCalled()
  })

  it('limits the summed master output without changing master volume', () => {
    const engine = new WebAudioEngine()
    engine.setMasterVolume(0.75)

    expect(context.compressors).toHaveLength(1)
    const limiter = context.compressors[0]
    expect(context.gainNodes[0].connect).toHaveBeenCalledWith(limiter)
    expect(limiter.connect).toHaveBeenCalledWith(context.destination)
    expect(limiter.threshold.value).toBe(-1)
    expect(limiter.knee.value).toBe(0)
    expect(limiter.ratio.value).toBe(20)
    expect(context.gainNodes[0].gain.value).toBe(0.75)
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

  it('prepares and plays the completion gong through the shared context', async () => {
    const engine = new WebAudioEngine()

    await engine.prepareCompletionGong()
    expect(context.resume).toHaveBeenCalledOnce()
    expect(fetchGong).toHaveBeenCalledWith('/audio/built-in/gong.ogg')
    expect(context.decodeAudioData).toHaveBeenCalledWith(gongBytes)

    await engine.playCompletionGong()
    expect(fetchGong).toHaveBeenCalledOnce()
    expect(context.bufferSources).toHaveLength(1)
    const source = context.bufferSources[0]
    expect(source.buffer).toEqual({ duration: 2 })
    expect(source.connect).toHaveBeenCalledWith(context.gainNodes[0])
    expect(source.start).toHaveBeenCalledOnce()

    source.dispatchEvent(new Event('ended'))
    expect(source.disconnect).toHaveBeenCalledOnce()
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
