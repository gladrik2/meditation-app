import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WebAudioEngine } from './WebAudioEngine'

class FakeNode {
  connect = vi.fn()
  disconnect = vi.fn()
}

class FakeGain extends FakeNode {
  gain = { value: 1 }
}

class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null
  onended: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
}

class FakeContext {
  state: AudioContextState = 'suspended'
  currentTime = 4
  destination = new FakeNode()
  gainNodes: FakeGain[] = []
  sources: FakeSource[] = []
  buffer = { duration: 20 } as AudioBuffer
  createGain = vi.fn(() => {
    const node = new FakeGain()
    this.gainNodes.push(node)
    return node
  })
  createBufferSource = vi.fn(() => {
    const node = new FakeSource()
    this.sources.push(node)
    return node
  })
  decodeAudioData = vi.fn(async () => this.buffer)
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
}

describe('WebAudioEngine', () => {
  let context: FakeContext

  beforeEach(() => {
    context = new FakeContext()
    function MockAudioContext() {
      return context
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext
    })
  })

  it('uses one context, decodes tracks, and routes through track and master gains', async () => {
    const engine = new WebAudioEngine()
    const file = new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    await engine.loadTrack('rain', file)
    await engine.loadTrack('wind', file)
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2)
    expect(context.gainNodes).toHaveLength(3)
    engine.setTrackVolume('rain', 0.35)
    engine.setMasterVolume(0.6)
    expect(context.gainNodes[1].gain.value).toBe(0.35)
    expect(context.gainNodes[0].gain.value).toBe(0.6)
  })

  it('resumes, schedules tracks together, stops, removes, and disposes resources', async () => {
    const engine = new WebAudioEngine()
    const file = new File(['audio'], 'rain.wav', { type: 'audio/wav' })
    await engine.loadTrack('rain', file)
    await engine.loadTrack('wind', file)
    await engine.playAll(['rain', 'wind'])
    expect(context.resume).toHaveBeenCalledOnce()
    expect(context.sources[0].start).toHaveBeenCalledWith(4.02, 0)
    expect(context.sources[1].start).toHaveBeenCalledWith(4.02, 0)
    engine.stopAll()
    expect(
      context.sources.every((source) => source.stop.mock.calls.length === 1)
    ).toBe(true)
    engine.removeTrack('rain')
    await engine.dispose()
    expect(context.close).toHaveBeenCalledOnce()
    expect(
      context.gainNodes.every((node) => node.disconnect.mock.calls.length > 0)
    ).toBe(true)
  })
})
