import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngineLoadError, type AudioEngine } from '../../audio/types'

export interface TrackViewModel {
  id: string
  name: string
  volume: number
  isPlaying: boolean
  isSoundEffect: boolean
  chance: number
  status: 'loading' | 'ready' | 'error'
  error?: string
}

const acceptedType = (file: File) => file.type.startsWith('audio/')
const SOUND_EFFECT_MAX_SECONDS = 10
const SOUND_EFFECT_COOLDOWN_MS = 10_000
const DEFAULT_CHANCE = 50

export function useTracks(engine: AudioEngine) {
  const [tracks, setTracks] = useState<TrackViewModel[]>([])
  const [masterVolume, setMasterVolumeState] = useState(1)
  const counter = useRef(0)
  const tracksRef = useRef(tracks)
  const lastEffectPlay = useRef(new Map<string, number>())

  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      for (const track of tracksRef.current) {
        if (
          !track.isSoundEffect ||
          !track.isPlaying ||
          track.status !== 'ready' ||
          now - (lastEffectPlay.current.get(track.id) ?? -Infinity) <
            SOUND_EFFECT_COOLDOWN_MS
        )
          continue

        if (Math.floor(Math.random() * track.chance) === 0) {
          lastEffectPlay.current.set(track.id, now)
          void engine.play(track.id)
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [engine])

  useEffect(() => () => void engine.dispose(), [engine])

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = `track-${counter.current++}`
        if (!acceptedType(file)) {
          setTracks((current) => [
            ...current,
            {
              id,
              name: file.name,
              volume: 1,
              isPlaying: false,
              isSoundEffect: false,
              chance: DEFAULT_CHANCE,
              status: 'error',
              error: 'Unsupported file type.'
            }
          ])
          continue
        }
        setTracks((current) => [
          ...current,
          {
            id,
            name: file.name,
            volume: 1,
            isPlaying: false,
            isSoundEffect: false,
            chance: DEFAULT_CHANCE,
            status: 'loading'
          }
        ])
        try {
          const duration = await engine.loadTrack(id, file)
          setTracks((current) =>
            current.map((track) =>
              track.id === id
                ? {
                    ...track,
                    status: 'ready',
                    isSoundEffect: duration <= SOUND_EFFECT_MAX_SECONDS
                  }
                : track
            )
          )
        } catch (error) {
          setTracks((current) =>
            current.map((track) =>
              track.id === id
                ? {
                    ...track,
                    status: 'error',
                    error:
                      error instanceof AudioEngineLoadError &&
                      error.category === 'unsupported-media'
                        ? 'Unsupported audio format.'
                        : 'This audio file could not be read or decoded.'
                  }
                : track
            )
          )
        }
      }
    },
    [engine]
  )

  const toggleTrack = async (track: TrackViewModel) => {
    if (track.isPlaying) engine.pause(track.id)
    else if (!track.isSoundEffect) await engine.play(track.id)
    setTracks((current) =>
      current.map((item) =>
        item.id === track.id ? { ...item, isPlaying: !track.isPlaying } : item
      )
    )
  }

  const removeTrack = (id: string) => {
    engine.removeTrack(id)
    lastEffectPlay.current.delete(id)
    setTracks((current) => current.filter((track) => track.id !== id))
  }

  const setEffectChance = (id: string, chance: number) => {
    const normalizedChance = Math.max(1, Math.floor(chance) || 1)
    setTracks((current) =>
      current.map((track) =>
        track.id === id ? { ...track, chance: normalizedChance } : track
      )
    )
  }

  const setTrackVolume = (id: string, volume: number) => {
    engine.setTrackVolume(id, volume)
    setTracks((current) =>
      current.map((track) => (track.id === id ? { ...track, volume } : track))
    )
  }

  const setMasterVolume = (volume: number) => {
    engine.setMasterVolume(volume)
    setMasterVolumeState(volume)
  }

  const playAll = async () => {
    const ids = tracks
      .filter((track) => track.status === 'ready' && !track.isSoundEffect)
      .map((track) => track.id)
    await engine.playAll(ids)
    setTracks((current) =>
      current.map((track) =>
        track.status === 'ready' ? { ...track, isPlaying: true } : track
      )
    )
  }

  const stopAll = () => {
    engine.stopAll()
    setTracks((current) =>
      current.map((track) => ({ ...track, isPlaying: false }))
    )
  }

  return {
    tracks,
    masterVolume,
    addFiles,
    toggleTrack,
    removeTrack,
    setTrackVolume,
    setEffectChance,
    setMasterVolume,
    playAll,
    stopAll
  }
}
