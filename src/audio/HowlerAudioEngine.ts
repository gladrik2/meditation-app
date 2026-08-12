import { Howl } from 'howler'
import {
  AudioEngineLoadError,
  type AudioEngine,
  type AudioLoadErrorCategory,
  type AudioTransportListener,
  type TrackId
} from './types'

interface EngineTrack {
  howl: Howl
  url: string
  volume: number
  soundId?: number
}

interface PendingTrack {
  url: string
  element: HTMLAudioElement
  cancel: () => void
}

const SOUND_EFFECT_MAX_SECONDS = 10
const STARTUP_FADE_MS = 20
const clampVolume = (value: number) => Math.min(1, Math.max(0, value))
const completionGongUrl = `${import.meta.env.BASE_URL}audio/built-in/gong.ogg`

const fileFormat = (file: File): string | undefined => {
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (extension) return extension === 'oga' ? 'ogg' : extension
  const subtype = file.type.toLowerCase().split(';', 1)[0].split('/')[1]
  return subtype?.replace('x-', '')
}

/** Howler-backed audio engine. Long tracks stream through HTML5 Audio while
 * short effects use Howler's shared Web Audio context. */
export class HowlerAudioEngine implements AudioEngine {
  private readonly tracks = new Map<TrackId, EngineTrack>()
  private readonly pendingTracks = new Map<TrackId, PendingTrack>()
  private readonly listeners = new Set<AudioTransportListener>()
  private completionGong: Howl | null = null
  private completionGongLoad: Promise<void> | null = null
  private masterVolume = 1
  private disposed = false

  subscribe(listener: AudioTransportListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(
    id: TrackId,
    state: Parameters<AudioTransportListener>[0]['state']
  ) {
    for (const listener of this.listeners) listener({ id, state })
  }

  async loadTrack(id: TrackId, file: File): Promise<number> {
    if (this.disposed) throw new Error('The audio engine has been disposed.')
    this.removeTrack(id)

    const url = URL.createObjectURL(file)
    const element = new Audio()
    element.preload = 'metadata'

    return new Promise<number>((resolve, reject) => {
      let settled = false
      let activeHowl: Howl | null = null
      const cleanUpProbe = () => {
        element.removeEventListener('loadedmetadata', onMetadata)
        element.removeEventListener('durationchange', onMetadata)
        element.removeEventListener('error', onProbeError)
        element.pause()
        element.removeAttribute('src')
        element.load()
      }
      const fail = (category: AudioLoadErrorCategory, message: string) => {
        if (settled) return
        settled = true
        cleanUpProbe()
        if (this.pendingTracks.get(id)?.element === element)
          this.pendingTracks.delete(id)
        activeHowl?.unload()
        URL.revokeObjectURL(url)
        reject(new AudioEngineLoadError(category, message))
      }
      const onProbeError = () =>
        fail(
          element.error?.code === 4
            ? 'unsupported-media'
            : 'metadata-read-failure',
          element.error?.code === 4
            ? 'The audio format is not supported.'
            : 'The audio metadata could not be read.'
        )
      const onMetadata = () => {
        if (!Number.isFinite(element.duration) || element.duration < 0) return
        if (settled || this.pendingTracks.get(id)?.element !== element) return

        const duration = element.duration
        cleanUpProbe()
        const track = { url, volume: 1 } as EngineTrack
        const howl = new Howl({
          src: [url],
          format: fileFormat(file) ? [fileFormat(file)!] : undefined,
          html5: duration > SOUND_EFFECT_MAX_SECONDS,
          preload: true,
          volume: 0,
          onplay: (soundId) => {
            howl.volume(0, soundId)
            howl.fade(
              0,
              track.volume * this.masterVolume,
              STARTUP_FADE_MS,
              soundId
            )
            this.emit(id, 'playing')
          },
          onpause: () => this.emit(id, 'paused'),
          onstop: (soundId) => {
            if (track.soundId === soundId) track.soundId = undefined
            this.emit(id, 'paused')
          },
          onend: (soundId) => {
            if (track.soundId === soundId) track.soundId = undefined
            this.emit(id, 'ended')
          },
          onplayerror: () => this.emit(id, 'error')
        })
        track.howl = howl
        activeHowl = howl
        const onLoad = () => {
          if (settled) return
          settled = true
          this.pendingTracks.delete(id)
          this.tracks.set(id, track)
          resolve(duration)
        }
        const onLoadError = () => {
          fail('unsupported-media', 'The audio format is not supported.')
        }
        howl.once('load', onLoad)
        howl.once('loaderror', onLoadError)
        // Cached media can finish loading during construction.
        if (howl.state() === 'loaded') onLoad()
      }
      const cancel = () =>
        fail('metadata-read-failure', 'Audio loading was cancelled.')

      this.pendingTracks.set(id, { url, element, cancel })
      element.addEventListener('loadedmetadata', onMetadata)
      element.addEventListener('durationchange', onMetadata)
      element.addEventListener('error', onProbeError)
      element.src = url
      element.load()
    })
  }

  async play(id: TrackId): Promise<void> {
    const track = this.tracks.get(id)
    if (!track) return
    await new Promise<void>((resolve, reject) => {
      if (track.soundId !== undefined) track.howl.volume(0, track.soundId)
      const soundId = track.howl.play(track.soundId)
      track.soundId = soundId
      track.howl.volume(0, soundId)
      track.howl.once('play', () => resolve(), soundId)
      track.howl.once('playerror', (_id, error) => reject(error), soundId)
      if (track.howl.playing(soundId)) resolve()
    })
  }

  pause(id: TrackId): void {
    const track = this.tracks.get(id)
    if (track?.soundId !== undefined) track.howl.pause(track.soundId)
  }

  async playAll(ids: TrackId[]): Promise<void> {
    await Promise.all(ids.map((id) => this.play(id)))
  }

  prepareCompletionGong(): Promise<void> {
    if (this.completionGong?.state() === 'loaded') return Promise.resolve()
    if (!this.completionGongLoad) {
      this.completionGongLoad = new Promise<void>((resolve, reject) => {
        const gong = new Howl({
          src: [completionGongUrl],
          format: ['ogg'],
          html5: false,
          preload: true,
          volume: this.masterVolume
        })
        this.completionGong = gong
        gong.once('load', () => resolve())
        gong.once('loaderror', (_id, error) => {
          gong.unload()
          this.completionGong = null
          this.completionGongLoad = null
          reject(error)
        })
        if (gong.state() === 'loaded') resolve()
      })
    }
    return this.completionGongLoad
  }

  async playCompletionGong(): Promise<void> {
    await this.prepareCompletionGong()
    this.completionGong?.play()
  }

  stopAll(): void {
    for (const track of this.tracks.values()) {
      if (track.soundId === undefined) continue
      const soundId = track.soundId
      track.howl.stop(soundId)
      track.soundId = undefined
    }
  }

  setTrackLoop(id: TrackId, loop: boolean): void {
    this.tracks.get(id)?.howl.loop(loop)
  }

  setTrackVolume(id: TrackId, volume: number): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.volume = clampVolume(volume)
    if (track.soundId !== undefined)
      track.howl.volume(track.volume * this.masterVolume, track.soundId)
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = clampVolume(volume)
    for (const track of this.tracks.values())
      if (track.soundId !== undefined)
        track.howl.volume(track.volume * this.masterVolume, track.soundId)
    this.completionGong?.volume(this.masterVolume)
  }

  removeTrack(id: TrackId): void {
    this.pendingTracks.get(id)?.cancel()
    const track = this.tracks.get(id)
    if (!track) return
    track.howl.unload()
    URL.revokeObjectURL(track.url)
    this.tracks.delete(id)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const pending of [...this.pendingTracks.values()]) pending.cancel()
    for (const id of [...this.tracks.keys()]) this.removeTrack(id)
    this.completionGong?.unload()
    this.completionGong = null
    this.completionGongLoad = null
    this.listeners.clear()
  }
}
