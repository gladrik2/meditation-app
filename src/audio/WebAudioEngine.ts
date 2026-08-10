import {
  AudioEngineLoadError,
  type AudioEngine,
  type AudioLoadErrorCategory,
  type AudioTransportListener,
  type TrackId
} from './types'

interface EngineTrack {
  file: File
  url: string
  element: HTMLAudioElement
  mediaSource: MediaElementAudioSourceNode
  gain: GainNode
  removeTransportListeners: () => void
}

interface PendingTrack {
  element: HTMLAudioElement
  url: string
  cancel: () => void
}

const clampVolume = (value: number) => Math.min(1, Math.max(0, value))

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private readonly tracks = new Map<TrackId, EngineTrack>()
  private readonly pendingTracks = new Map<TrackId, PendingTrack>()
  private readonly listeners = new Set<AudioTransportListener>()
  private completionGong: HTMLAudioElement | null = null
  private completionGongSource: MediaElementAudioSourceNode | null = null
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

  private getContext(): AudioContext {
    if (this.disposed) throw new Error('The audio engine has been disposed.')
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
    this.removeTrack(id)

    const url = URL.createObjectURL(file)
    const element = new Audio()
    element.preload = 'metadata'

    return new Promise<number>((resolve, reject) => {
      let settled = false

      const cleanUpListeners = () => {
        element.removeEventListener('loadedmetadata', onMetadata)
        element.removeEventListener('durationchange', onMetadata)
        element.removeEventListener('error', onError)
      }
      const releaseElement = () => {
        element.pause()
        element.removeAttribute('src')
        element.load()
        URL.revokeObjectURL(url)
      }
      const fail = (category: AudioLoadErrorCategory, message: string) => {
        if (settled) return
        settled = true
        cleanUpListeners()
        if (this.pendingTracks.get(id)?.element === element)
          this.pendingTracks.delete(id)
        releaseElement()
        reject(new AudioEngineLoadError(category, message))
      }
      const onMetadata = () => {
        if (!Number.isFinite(element.duration) || element.duration < 0) return
        if (settled || this.pendingTracks.get(id)?.element !== element) return

        let gain: GainNode | undefined
        let mediaSource: MediaElementAudioSourceNode | undefined
        try {
          gain = context.createGain()
          mediaSource = context.createMediaElementSource(element)
          mediaSource.connect(gain)
          gain.connect(this.masterGain!)
          settled = true
          cleanUpListeners()
          this.pendingTracks.delete(id)
          const onPlay = () => this.emit(id, 'playing')
          const onPause = () => this.emit(id, 'paused')
          const onEnded = () => this.emit(id, 'ended')
          const onTransportError = () => this.emit(id, 'error')
          element.addEventListener('play', onPlay)
          element.addEventListener('pause', onPause)
          element.addEventListener('ended', onEnded)
          element.addEventListener('error', onTransportError)
          const removeTransportListeners = () => {
            element.removeEventListener('play', onPlay)
            element.removeEventListener('pause', onPause)
            element.removeEventListener('ended', onEnded)
            element.removeEventListener('error', onTransportError)
          }
          this.tracks.set(id, {
            file,
            url,
            element,
            mediaSource,
            gain,
            removeTransportListeners
          })
          resolve(element.duration)
        } catch {
          mediaSource?.disconnect()
          gain?.disconnect()
          fail(
            'metadata-read-failure',
            'The audio media source could not be created.'
          )
        }
      }
      const onError = () => {
        // MEDIA_ERR_SRC_NOT_SUPPORTED is specified as code 4. Comparing the
        // code also works in browsers that do not expose MediaError globally.
        const unsupported = element.error?.code === 4
        fail(
          unsupported ? 'unsupported-media' : 'metadata-read-failure',
          unsupported
            ? 'The audio format is not supported.'
            : 'The audio metadata could not be read.'
        )
      }
      const cancel = () =>
        fail('metadata-read-failure', 'Audio loading was cancelled.')

      this.pendingTracks.set(id, { element, url, cancel })
      element.addEventListener('loadedmetadata', onMetadata)
      element.addEventListener('durationchange', onMetadata)
      element.addEventListener('error', onError)
      element.src = url
      element.load()
    })
  }

  async play(id: TrackId): Promise<void> {
    await this.resume()
    const track = this.tracks.get(id)
    if (!track) return
    if (track.element.ended) track.element.currentTime = 0
    await track.element.play()
  }

  pause(id: TrackId): void {
    this.tracks.get(id)?.element.pause()
  }

  async playAll(ids: TrackId[]): Promise<void> {
    await this.resume()
    await Promise.all(
      ids.map(async (id) => {
        const track = this.tracks.get(id)
        if (!track) return
        if (track.element.ended) track.element.currentTime = 0
        await track.element.play()
      })
    )
  }

  async prepareCompletionGong(): Promise<void> {
    const context = await this.resume()
    if (this.completionGong) return

    const gong = new Audio('/audio/built-in/gong.ogg')
    gong.preload = 'auto'
    const source = context.createMediaElementSource(gong)
    source.connect(this.masterGain!)
    gong.load()
    this.completionGong = gong
    this.completionGongSource = source
  }

  async playCompletionGong(): Promise<void> {
    await this.prepareCompletionGong()
    this.completionGong!.currentTime = 0
    await this.completionGong!.play()
  }

  stopAll(): void {
    for (const track of this.tracks.values()) {
      track.element.pause()
      track.element.currentTime = 0
    }
  }

  setTrackLoop(id: TrackId, loop: boolean): void {
    const track = this.tracks.get(id)
    if (track) track.element.loop = loop
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
    this.pendingTracks.get(id)?.cancel()
    const track = this.tracks.get(id)
    if (!track) return
    track.removeTransportListeners()
    track.element.pause()
    track.element.removeAttribute('src')
    track.element.load()
    track.mediaSource.disconnect()
    track.gain.disconnect()
    URL.revokeObjectURL(track.url)
    this.tracks.delete(id)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const pending of [...this.pendingTracks.values()]) pending.cancel()
    for (const id of [...this.tracks.keys()]) this.removeTrack(id)
    this.completionGong?.pause()
    this.completionGong?.removeAttribute('src')
    this.completionGong?.load()
    this.completionGongSource?.disconnect()
    this.completionGong = null
    this.completionGongSource = null
    this.masterGain?.disconnect()
    if (this.context && this.context.state !== 'closed')
      await this.context.close()
    this.context = null
    this.masterGain = null
    this.listeners.clear()
  }
}
