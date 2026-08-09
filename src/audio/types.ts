export type TrackId = string

export type AudioLoadErrorCategory =
  'unsupported-media' | 'metadata-read-failure'

export class AudioEngineLoadError extends Error {
  constructor(
    public readonly category: AudioLoadErrorCategory,
    message: string
  ) {
    super(message)
    this.name = 'AudioEngineLoadError'
  }
}

export type AudioTransportState = 'playing' | 'paused' | 'ended' | 'error'

export interface AudioTransportEvent {
  id: TrackId
  state: AudioTransportState
}

export type AudioTransportListener = (event: AudioTransportEvent) => void

export interface AudioEngine {
  subscribe(listener: AudioTransportListener): () => void
  loadTrack(id: TrackId, file: File): Promise<number>
  play(id: TrackId): Promise<void>
  pause(id: TrackId): void
  playAll(ids: TrackId[]): Promise<void>
  stopAll(): void
  setTrackLoop(id: TrackId, loop: boolean): void
  setTrackVolume(id: TrackId, volume: number): void
  setMasterVolume(volume: number): void
  removeTrack(id: TrackId): void
  dispose(): Promise<void>
}
