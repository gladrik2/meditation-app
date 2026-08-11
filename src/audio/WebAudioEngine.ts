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
  startGain: GainNode
  gain: GainNode
  fadeOutTimer: ReturnType<typeof setTimeout> | null
  removeTransportListeners: () => void
}

interface PendingTrack {
  element: HTMLAudioElement
  url: string
  cancel: () => void
}

const clampVolume = (value: number) => Math.min(1, Math.max(0, value))
const transportEnvelopeSeconds = 0.015
const transportPauseDelayMilliseconds = 100
const completionGongUrl = `${import.meta.env.BASE_URL}audio/built-in/gong.ogg`

export class WebAudioEngine implements AudioEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private outputLimiter: DynamicsCompressorNode | null = null
  private readonly tracks = new Map<TrackId, EngineTrack>()
  private readonly pendingTracks = new Map<TrackId, PendingTrack>()
  private readonly listeners = new Set<AudioTransportListener>()
  private completionGongBuffer: AudioBuffer | null = null
  private completionGongLoad: Promise<void> | null = null
  private readonly completionGongSources = new Set<AudioBufferSourceNode>()
  private disposed = false

  constructor(
    private readonly bypassOutputLimiter = new URLSearchParams(
      window.location.search
    ).has('bypassLimiter')
  ) {}

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
      if (this.bypassOutputLimiter) {
        this.masterGain.connect(this.context.destination)
      } else {
        this.outputLimiter = this.context.createDynamicsCompressor()
        this.outputLimiter.threshold.value = -1
        this.outputLimiter.knee.value = 0
        this.outputLimiter.ratio.value = 20
        this.outputLimiter.attack.value = 0.003
        this.outputLimiter.release.value = 0.1
        this.masterGain.connect(this.outputLimiter)
        this.outputLimiter.connect(this.context.destination)
      }
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
        let startGain: GainNode | undefined
        let mediaSource: MediaElementAudioSourceNode | undefined
        try {
          gain = context.createGain()
          startGain = context.createGain()
          mediaSource = context.createMediaElementSource(element)
          mediaSource.connect(startGain)
          startGain.connect(gain)
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
            startGain,
            gain,
            fadeOutTimer: null,
            removeTransportListeners
          })
          resolve(element.duration)
        } catch {
          mediaSource?.disconnect()
          startGain?.disconnect()
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
    const context = await this.resume()
    const track = this.tracks.get(id)
    if (!track) return
    await this.startTrack(track, context)
  }

  pause(id: TrackId): void {
    const track = this.tracks.get(id)
    if (track) this.fadeOutTrack(track, () => track.element.pause())
  }

  async playAll(ids: TrackId[]): Promise<void> {
    const context = await this.resume()
    await Promise.all(
      ids.map(async (id) => {
        const track = this.tracks.get(id)
        if (!track) return
        await this.startTrack(track, context)
      })
    )
  }

  private async startTrack(
    track: EngineTrack,
    context: AudioContext
  ): Promise<void> {
    if (track.element.ended) track.element.currentTime = 0
    this.cancelFadeOut(track)
    const gain = track.startGain.gain
    const muteTime = context.currentTime
    gain.cancelScheduledValues(muteTime)
    gain.setValueAtTime(0, muteTime)
    try {
      await track.element.play()
    } catch (error) {
      const restoreTime = context.currentTime
      gain.cancelScheduledValues(restoreTime)
      gain.setValueAtTime(1, restoreTime)
      throw error
    }
    const fadeStartTime = context.currentTime
    gain.setValueAtTime(0, fadeStartTime)
    gain.linearRampToValueAtTime(1, fadeStartTime + transportEnvelopeSeconds)
  }

  private cancelFadeOut(track: EngineTrack): void {
    if (track.fadeOutTimer === null) return
    clearTimeout(track.fadeOutTimer)
    track.fadeOutTimer = null
  }

  private fadeOutTrack(track: EngineTrack, onComplete: () => void): void {
    this.cancelFadeOut(track)
    const gain = track.startGain.gain
    const fadeStartTime = this.getContext().currentTime
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(fadeStartTime)
    } else {
      gain.cancelScheduledValues(fadeStartTime)
      gain.setValueAtTime(gain.value, fadeStartTime)
    }
    gain.linearRampToValueAtTime(0, fadeStartTime + transportEnvelopeSeconds)
    track.fadeOutTimer = setTimeout(() => {
      track.fadeOutTimer = null
      onComplete()
    }, transportPauseDelayMilliseconds)
  }

  async prepareCompletionGong(): Promise<void> {
    const context = await this.resume()
    if (this.completionGongBuffer) return
    if (!this.completionGongLoad) {
      this.completionGongLoad = fetch(completionGongUrl)
        .then((response) => {
          if (!response.ok)
            throw new Error('The completion gong could not load.')
          return response.arrayBuffer()
        })
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          this.completionGongBuffer = buffer
        })
        .catch((error: unknown) => {
          this.completionGongLoad = null
          throw error
        })
    }
    await this.completionGongLoad
  }

  async playCompletionGong(): Promise<void> {
    await this.prepareCompletionGong()
    const source = this.getContext().createBufferSource()
    source.buffer = this.completionGongBuffer
    source.connect(this.masterGain!)
    source.addEventListener('ended', () => {
      source.disconnect()
      this.completionGongSources.delete(source)
    })
    this.completionGongSources.add(source)
    source.start()
  }

  stopAll(): void {
    for (const track of this.tracks.values()) {
      this.fadeOutTrack(track, () => {
        track.element.pause()
        track.element.currentTime = 0
      })
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
    this.cancelFadeOut(track)
    track.removeTransportListeners()
    track.element.pause()
    track.element.removeAttribute('src')
    track.element.load()
    track.mediaSource.disconnect()
    track.startGain.disconnect()
    track.gain.disconnect()
    URL.revokeObjectURL(track.url)
    this.tracks.delete(id)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const pending of [...this.pendingTracks.values()]) pending.cancel()
    for (const id of [...this.tracks.keys()]) this.removeTrack(id)
    for (const source of this.completionGongSources) {
      source.stop()
      source.disconnect()
    }
    this.completionGongSources.clear()
    this.completionGongBuffer = null
    this.completionGongLoad = null
    this.masterGain?.disconnect()
    this.outputLimiter?.disconnect()
    if (this.context && this.context.state !== 'closed')
      await this.context.close()
    this.context = null
    this.masterGain = null
    this.outputLimiter = null
    this.listeners.clear()
  }
}
