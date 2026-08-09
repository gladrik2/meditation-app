import type { AudioEngine, TrackId } from './types'

interface EngineTrack {
  buffer: AudioBuffer
  gain: GainNode
  source: AudioBufferSourceNode | null
  offset: number
  startedAt: number
}

const clampVolume = (value: number) => Math.min(1, Math.max(0, value))

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private readonly tracks = new Map<TrackId, EngineTrack>()

  private getContext(): AudioContext {
    if (!this.context) {
      const AudioContextConstructor = window.AudioContext
      if (!AudioContextConstructor)
        throw new Error('Web Audio is not supported by this browser.')
      this.context = new AudioContextConstructor()
      this.masterGain = this.context.createGain()
      this.masterGain.connect(this.context.destination)
    }
    return this.context
  }

  private async resume(): Promise<AudioContext> {
    const context = this.getContext()
    if (context.state === 'suspended') await context.resume()
    return context
  }

  async loadTrack(id: TrackId, file: File): Promise<number> {
    const context = this.getContext()
    const data = await file.arrayBuffer()
    const buffer = await context.decodeAudioData(data)
    const gain = context.createGain()
    gain.connect(this.masterGain!)
    this.tracks.set(id, { buffer, gain, source: null, offset: 0, startedAt: 0 })
    return buffer.duration
  }

  private startTrack(
    id: TrackId,
    context: AudioContext,
    when = context.currentTime
  ): void {
    const track = this.tracks.get(id)
    if (!track || track.source) return
    const source = context.createBufferSource()
    source.buffer = track.buffer
    source.connect(track.gain)
    track.source = source
    track.startedAt = when
    // BufferSource nodes are single-use, so pausing stops this node and playing creates another.
    source.start(when, track.offset)
    source.onended = () => {
      if (track.source !== source) return
      source.disconnect()
      track.source = null
      track.offset = 0
    }
  }

  async play(id: TrackId): Promise<void> {
    const context = await this.resume()
    this.startTrack(id, context)
  }

  pause(id: TrackId): void {
    const track = this.tracks.get(id)
    if (!track?.source || !this.context) return
    track.offset =
      (track.offset + this.context.currentTime - track.startedAt) %
      track.buffer.duration
    const source = track.source
    track.source = null
    source.onended = null
    source.stop()
    source.disconnect()
  }

  async playAll(ids: TrackId[]): Promise<void> {
    const context = await this.resume()
    const when = context.currentTime + 0.02
    ids.forEach((id) => this.startTrack(id, context, when))
  }

  stopAll(): void {
    for (const [id, track] of this.tracks) {
      this.pause(id)
      track.offset = 0
    }
  }

  setTrackVolume(id: TrackId, volume: number): void {
    const track = this.tracks.get(id)
    if (track) track.gain.gain.value = clampVolume(volume)
  }

  setMasterVolume(volume: number): void {
    this.getContext()
    this.masterGain!.gain.value = clampVolume(volume)
  }

  removeTrack(id: TrackId): void {
    const track = this.tracks.get(id)
    if (!track) return
    this.pause(id)
    track.gain.disconnect()
    this.tracks.delete(id)
  }

  async dispose(): Promise<void> {
    this.stopAll()
    for (const track of this.tracks.values()) track.gain.disconnect()
    this.tracks.clear()
    this.masterGain?.disconnect()
    if (this.context && this.context.state !== 'closed')
      await this.context.close()
    this.context = null
    this.masterGain = null
  }
}
