import { useEffect, useMemo, useRef, useState } from 'react'
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
import { LocalSoundscapeStore } from '../soundscapes/localSoundscapes'
import {
  SOUNDSCAPE_MANIFEST_VERSION,
  type SoundscapeManifest
} from '../soundscapes/manifest'
import {
  importDriveSoundscape,
  publishSoundscape
} from '../googleDrive/googleDriveSoundscapes'

interface AppProps {
  engine?: AudioEngine
  driveAuth?: GoogleDriveAuth
}

export function App({ engine: suppliedEngine, driveAuth }: AppProps) {
  const engine = useMemo(
    () => suppliedEngine ?? new HowlerAudioEngine(),
    [suppliedEngine]
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<SoundscapeImageHandle>(null)
  const restorationStarted = useRef(false)
  const [image, setImage] = useState<File | null>(null)
  const [savedId, setSavedId] = useState<string>()
  const [saveMessage, setSaveMessage] = useState<string>()
  const localStore = useMemo(() => new LocalSoundscapeStore(), [])
  const controls = useTracks(engine)
  const ready = controls.tracks.some((track) => track.status === 'ready')
  const addSelectedFiles = (files: File[]) => {
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
  }
  const googleDriveAuth = useMemo(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
    return (
      driveAuth ?? (clientId ? new BrowserGoogleDriveAuth(clientId) : undefined)
    )
  }, [driveAuth])

  const restoreSoundscape = async (
    restored: Awaited<ReturnType<LocalSoundscapeStore['restoreLast']>>
  ) => {
    if (!restored) return
    const { manifest, files } = restored
    const trackFiles = manifest.tracks.map((track) =>
      files.get(track.reference.localPath)
    )
    if (trackFiles.some((file) => !file))
      throw new Error('A saved soundscape file is missing from local storage.')
    controls.clearTracks()
    await controls.addFiles(
      trackFiles as File[],
      manifest.tracks.map((track) => ({
        volume: track.volume,
        isSoundEffect: track.isSoundEffect,
        effectChance: track.effectChance
      }))
    )
    controls.setMasterVolume(manifest.masterVolume)
    setImage(
      manifest.image
        ? (files.get(manifest.image.reference.localPath) ?? null)
        : null
    )
    setSavedId(manifest.id)
    setSaveMessage(`Restored “${manifest.name}” from this device.`)
  }

  useEffect(() => {
    if (restorationStarted.current) return
    restorationStarted.current = true
    void localStore
      .restoreLast()
      .then(restoreSoundscape)
      .catch((error: unknown) => {
        setSaveMessage(
          error instanceof Error
            ? error.message
            : 'The soundscape could not be restored.'
        )
      })
    // Restoration runs only for this application/store instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStore])

  const buildManifest = (name: string) => {
    const id = savedId ?? crypto.randomUUID()
    const files = new Map<string, File>()
    const uniquePath = (prefix: string, index: number, file: File) =>
      `${prefix}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const tracks = controls.tracks
      .filter((track) => track.status === 'ready')
      .map((track, index) => {
        const file = controls.getTrackFile(track.id)
        if (!file)
          throw new Error(`The media file “${track.name}” is unavailable.`)
        const localPath = uniquePath('track', index, file)
        files.set(localPath, file)
        return {
          name: file.name,
          mimeType: file.type,
          size: file.size,
          volume: track.volume,
          isSoundEffect: track.isSoundEffect,
          effectChance: track.chance,
          reference: { localPath }
        }
      })
    let manifestImage: SoundscapeManifest['image']
    if (image) {
      const localPath = uniquePath('image', 0, image)
      files.set(localPath, image)
      manifestImage = {
        name: image.name,
        mimeType: image.type,
        size: image.size,
        reference: { localPath }
      }
    }
    const manifest: SoundscapeManifest = {
      version: SOUNDSCAPE_MANIFEST_VERSION,
      id,
      name,
      updatedAt: new Date().toISOString(),
      masterVolume: controls.masterVolume,
      image: manifestImage,
      tracks
    }
    return { manifest, files }
  }

  const saveLocally = async () => {
    const name = window.prompt('Soundscape name', 'My soundscape')?.trim()
    if (!name) return
    setSaveMessage('Saving…')
    try {
      const { manifest, files } = buildManifest(name)
      const persistent = await localStore.requestPersistence()
      await localStore.save(manifest, files)
      setSavedId(manifest.id)
      setSaveMessage(
        persistent
          ? `Saved “${name}” on this device.`
          : `Saved “${name}”. Your browser may clear it when storage is low.`
      )
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Saving failed.')
    }
  }

  const deleteSaved = async () => {
    if (!savedId) return
    try {
      await localStore.delete(savedId)
      setSavedId(undefined)
      setSaveMessage('Deleted the saved soundscape and its cached media.')
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : 'Deletion failed.'
      )
    }
  }

  const driveToken = async () => {
    if (!googleDriveAuth)
      throw new Error('Google Drive is not configured for this app.')
    return googleDriveAuth.getAccessToken() ?? (await googleDriveAuth.connect())
  }

  const saveToDrive = async () => {
    const name = window.prompt('Soundscape name', 'My soundscape')?.trim()
    if (!name) return
    setSaveMessage('Uploading to Google Drive…')
    try {
      const token = await driveToken()
      if (!token) {
        setSaveMessage(undefined)
        return
      }
      const { manifest, files } = buildManifest(name)
      await publishSoundscape(manifest, files, token)
      await localStore.save(manifest, files)
      setSavedId(manifest.id)
      setSaveMessage(`Saved “${name}” to Google Drive.`)
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : 'Drive upload failed.'
      )
    }
  }

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
            processed locally in your browser unless you explicitly save a
            soundscape to your Google Drive.
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
            onChooseDevice={() => inputRef.current?.click()}
            onOpenDriveSoundscape={async (fileId, token) => {
              setSaveMessage('Downloading soundscape from Google Drive…')
              try {
                await restoreSoundscape(
                  await importDriveSoundscape(fileId, token, localStore)
                )
              } catch (error) {
                setSaveMessage(
                  error instanceof Error
                    ? error.message
                    : 'Drive import failed.'
                )
                throw error
              }
            }}
          />
          <p className="file-help">
            Select multiple audio files and one optional image
          </p>
          <div className="soundscape-storage-actions">
            <button type="button" onClick={() => void saveLocally()}>
              Save on this device
            </button>
            <button type="button" onClick={() => void saveToDrive()}>
              Save to Google Drive
            </button>
            {savedId && (
              <button type="button" onClick={() => void deleteSaved()}>
                Delete saved soundscape
              </button>
            )}
          </div>
          {saveMessage && <p role="status">{saveMessage}</p>}
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
          Unsaved files are forgotten when you close or refresh the app. Saved
          soundscapes remain in private browser storage until you delete them.
        </p>
      </footer>
    </div>
  )
}
