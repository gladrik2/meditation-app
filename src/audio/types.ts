export type TrackId = string

export interface AudioEngine {
  loadTrack(id: TrackId, file: File): Promise<void>
  play(id: TrackId): Promise<void>
  pause(id: TrackId): void
  playAll(ids: TrackId[]): Promise<void>
  stopAll(): void
  setTrackVolume(id: TrackId, volume: number): void
  setMasterVolume(volume: number): void
  removeTrack(id: TrackId): void
  dispose(): Promise<void>
}
