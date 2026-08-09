import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioEngineLoadError } from './types'
import { WebAudioEngine } from './WebAudioEngine'

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeGain extends FakeNode {
  gain = { value: 1 }
}

class FakeMediaSource extends FakeNode {}

class FakeContext {
  state: AudioContextState = 'suspended'
  destination = new FakeNode()
  gainNodes: FakeGain[] = []
  mediaSources: FakeMediaSource[] = []
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
  })

  it('uses media element transport and releases resources', async () => {
    const engine = new WebAudioEngine()
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
    rain.currentTime = 8
    engine.pause('rain')
    expect(rain.pause).toHaveBeenCalledOnce()
    expect(rain.currentTime).toBe(8)
    engine.stopAll()
    expect(rain.currentTime).toBe(0)
    expect(wind.currentTime).toBe(0)

    engine.removeTrack('rain')
    expect(rain.removeAttribute).toHaveBeenCalledWith('src')
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
