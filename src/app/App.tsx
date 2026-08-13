import { useCallback, useMemo, useRef, useState } from 'react'
import { HowlerAudioEngine } from '../audio/HowlerAudioEngine'
import type { AudioEngine } from '../audio/types'
import { TrackList } from '../components/TrackList'
import { MeditationTimer } from '../components/MeditationTimer'
import {
  SoundscapeImage,
  type SoundscapeImageHandle
} from '../components/SoundscapeImage'
import { VolumeControl } from '../components/VolumeControl'
import { AudioSourceChooser } from '../components/AudioSourceChooser'
import { useTracks } from '../features/tracks/useTracks'
import {
  BrowserGoogleDriveAuth,
  type GoogleDriveAuth
} from '../googleDrive/googleDriveAuth'
import {
  BrowserGoogleDrivePicker,
  type GoogleDrivePicker
} from '../googleDrive/googleDrivePicker'

interface AppProps {
  engine?: AudioEngine
  driveAuth?: GoogleDriveAuth
  drivePicker?: GoogleDrivePicker
}

export function App({
  engine: suppliedEngine,
  driveAuth,
  drivePicker
}: AppProps) {
  const engine = useMemo(
    () => suppliedEngine ?? new HowlerAudioEngine(),
    [suppliedEngine]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<SoundscapeImageHandle>(null)
  const [image, setImage] = useState<File | null>(null)
  const controls = useTracks(engine)
  const addFiles = controls.addFiles
  const ready = controls.tracks.some((track) => track.status === 'ready')
  const googleDriveAuth = useMemo(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
    return (
      driveAuth ?? (clientId ? new BrowserGoogleDriveAuth(clientId) : undefined)
    )
  }, [driveAuth])
  const googleDrivePicker = useMemo(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY?.trim()
    const appId = import.meta.env.VITE_GOOGLE_APP_ID?.trim()
    return (
      drivePicker ??
      (apiKey ? new BrowserGoogleDrivePicker(apiKey, appId) : undefined)
    )
  }, [drivePicker])
  const addSelectedFiles = useCallback(
    (files: File[]) => {
      const audioAndUnsupportedFiles = files.filter(
        (file) => !file.type.startsWith('image/')
      )
      const selectedImages = files.filter((file) =>
        file.type.startsWith('image/')
      )

      if (audioAndUnsupportedFiles.length > 0) {
        void addFiles(audioAndUnsupportedFiles)
      }
      if (selectedImages.length > 0) {
        setImage(selectedImages.at(-1) ?? null)
      }
    },
    [addFiles]
  )

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="./" aria-label="Local Soundscape home">
          <span className="brand-mark" aria-hidden="true">
            ∿
          </span>
          Local Soundscape
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <h1 id="page-title">
            Layer sounds.
            <br />
            Find your calm.
          </h1>
          <p className="intro">
            Mix multiple audio tracks into a personal soundscape. Audio is
            processed locally in your browser. Selected files are never uploaded
            by this app.
          </p>
          <input
            ref={inputRef}
            className="visually-hidden"
            id="audio-files"
            type="file"
            accept="audio/*,audio/ogg,audio/opus,audio/webm,application/ogg,application/x-ogg,.opus,.ogg,image/*"
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              addSelectedFiles(files)
              event.currentTarget.value = ''
            }}
          />
          <AudioSourceChooser
            driveAuth={googleDriveAuth}
            drivePicker={googleDrivePicker}
            onChooseFiles={addSelectedFiles}
            onChooseDevice={() => inputRef.current?.click()}
          />
          <p className="file-help">
            Select multiple audio files and one optional image
          </p>
        </section>

        <section className="mixer" aria-label="Soundscape mixer">
          <SoundscapeImage
            ref={imageRef}
            image={image}
            onChoose={() => inputRef.current?.click()}
            onRemove={() => setImage(null)}
          />
          <MeditationTimer
            onStart={() => {
              void engine.prepareCompletionGong().catch((error: unknown) => {
                console.error('Failed to prepare the completion gong.', error)
              })
            }}
            onStartWithMedia={() => {
              imageRef.current?.enterFullscreen()
              return controls.playAll()
            }}
            onComplete={() => {
              controls.stopAll()
              void engine.playCompletionGong().catch((error: unknown) => {
                console.error('Failed to play the completion gong.', error)
              })
              imageRef.current?.showCompletionBlackout()
            }}
          />
          <div className="master-controls">
            <div className="master-buttons">
              <button
                type="button"
                className="primary-control"
                disabled={!ready}
                onClick={() => void controls.playAll()}
              >
                ▶ Play All
              </button>
              <button
                type="button"
                className="secondary-control"
                disabled={!ready}
                onClick={controls.stopAll}
              >
                ■ Stop All
              </button>
            </div>
            <VolumeControl
              id="master-volume"
              label="Master volume"
              value={controls.masterVolume}
              onChange={controls.setMasterVolume}
            />
          </div>
          <TrackList
            tracks={controls.tracks}
            onToggle={controls.toggleTrack}
            onRemove={controls.removeTrack}
            onVolume={controls.setTrackVolume}
            onEffectChance={controls.setEffectChance}
          />
        </section>
      </main>

      <footer>
        <p>
          Audio is processed locally in your browser. Device and Google Drive
          files are never uploaded by this app and are forgotten when you close
          or refresh it.
        </p>
      </footer>
    </div>
  )
}
