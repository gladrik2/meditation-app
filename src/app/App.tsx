import { useMemo, useRef, useState } from 'react'
import { WebAudioEngine } from '../audio/WebAudioEngine'
import type { AudioEngine } from '../audio/types'
import { TrackList } from '../components/TrackList'
import { MeditationTimer } from '../components/MeditationTimer'
import { SoundscapeImage } from '../components/SoundscapeImage'
import { VolumeControl } from '../components/VolumeControl'
import { useTracks } from '../features/tracks/useTracks'

interface AppProps {
  engine?: AudioEngine
}

export function App({ engine: suppliedEngine }: AppProps) {
  const engine = useMemo(
    () => suppliedEngine ?? new WebAudioEngine(),
    [suppliedEngine]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<File | null>(null)
  const controls = useTracks(engine)
  const ready = controls.tracks.some((track) => track.status === 'ready')

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
            Mix multiple audio tracks into a personal soundscape. Everything is
            processed in your browser—your files never leave your device.
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
              const audioAndUnsupportedFiles = files.filter(
                (file) => !file.type.startsWith('image/')
              )
              const selectedImages = files.filter((file) =>
                file.type.startsWith('image/')
              )

              if (audioAndUnsupportedFiles.length > 0) {
                void controls.addFiles(audioAndUnsupportedFiles)
              }
              if (selectedImages.length > 0) {
                setImage(selectedImages.at(-1) ?? null)
              }
              event.currentTarget.value = ''
            }}
          />
          <button
            className="choose-button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <span aria-hidden="true">＋</span> Choose files
          </button>
          <p className="file-help">
            Select multiple audio files and one optional image
          </p>
        </section>

        <section className="mixer" aria-label="Soundscape mixer">
          <SoundscapeImage
            image={image}
            onChoose={() => inputRef.current?.click()}
            onRemove={() => setImage(null)}
          />
          <MeditationTimer
            disabled={!ready}
            onStart={controls.playAll}
            onPause={controls.pauseAll}
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
          Your audio stays on this device and is never uploaded. Files are
          forgotten when you close or refresh the app.
        </p>
      </footer>
    </div>
  )
}
