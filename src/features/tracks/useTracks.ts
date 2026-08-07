import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioEngine } from '../../audio/types'

export interface TrackViewModel {
  id: string
  name: string
  volume: number
  isPlaying: boolean
  status: 'loading' | 'ready' | 'error'
  error?: string
}

const acceptedType = (file: File) => file.type.startsWith('audio/')

export function useTracks(engine: AudioEngine) {
  const [tracks, setTracks] = useState<TrackViewModel[]>([])
  const [masterVolume, setMasterVolumeState] = useState(1)
  const counter = useRef(0)

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
            status: 'loading'
          }
        ])
        try {
          await engine.loadTrack(id, file)
          setTracks((current) =>
            current.map((track) =>
              track.id === id ? { ...track, status: 'ready' } : track
            )
          )
        } catch {
          setTracks((current) =>
            current.map((track) =>
              track.id === id
                ? {
                    ...track,
                    status: 'error',
                    error: 'This audio file could not be read or decoded.'
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
    else await engine.play(track.id)
    setTracks((current) =>
      current.map((item) =>
        item.id === track.id ? { ...item, isPlaying: !track.isPlaying } : item
      )
    )
  }

  const removeTrack = (id: string) => {
    engine.removeTrack(id)
    setTracks((current) => current.filter((track) => track.id !== id))
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
      .filter((track) => track.status === 'ready')
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
    setMasterVolume,
    playAll,
    stopAll
  }
}
