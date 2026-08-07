import { useMemo, useRef } from 'react'
import { WebAudioEngine } from '../audio/WebAudioEngine'
import type { AudioEngine } from '../audio/types'
import { TrackList } from '../components/TrackList'
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
        <span className="privacy-badge">Private by design</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Your audio, your space</p>
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
            accept="audio/*"
            multiple
            onChange={(event) => {
              if (event.currentTarget.files)
                void controls.addFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }}
          />
          <button
            className="choose-button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <span aria-hidden="true">＋</span> Choose audio files
          </button>
          <p className="file-help">
            MP3, WAV, OGG, and other formats supported by your browser
          </p>
        </section>

        <section className="mixer" aria-label="Soundscape mixer">
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
          />
        </section>
      </main>

      <footer>
        <p>
          <strong>Private by design.</strong> Your audio stays on this device
          and is never uploaded. Files are forgotten when you close or refresh
          the app.
        </p>
      </footer>
    </div>
  )
}
