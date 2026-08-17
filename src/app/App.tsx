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
  DEFAULT_MEDITATION_TIMER_SETTINGS,
  nextSoundscapeName,
  validateSoundscapeName,
  type MeditationTimerSettings,
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
  const [imageLocalPath, setImageLocalPath] = useState<string>()
  const [savedId, setSavedId] = useState<string>()
  const [savedName, setSavedName] = useState<string>()
  const [savedSoundscapes, setSavedSoundscapes] = useState<
    SoundscapeManifest[]
  >([])
  const [saveMessage, setSaveMessage] = useState<string>()
  const [timerSettings, setTimerSettings] = useState<MeditationTimerSettings>(
    () => ({ ...DEFAULT_MEDITATION_TIMER_SETTINGS })
  )
  const [timerSessionKey, setTimerSessionKey] = useState(0)
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
      setImageLocalPath(undefined)
    }
  }
  const googleDriveAuth = useMemo(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()
    return (
      driveAuth ?? (clientId ? new BrowserGoogleDriveAuth(clientId) : undefined)
    )
  }, [driveAuth])

  const restoreSoundscape = async (
    restored: Awaited<ReturnType<LocalSoundscapeStore['restoreLast']>>,
    source: 'this device' | 'Google Drive' = 'this device'
  ) => {
    if (!restored) return
    const { manifest, files } = restored
    setTimerSessionKey((key) => key + 1)
    setTimerSettings({ ...manifest.timerSettings })
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
        effectChance: track.effectChance,
        localPath: track.reference.localPath
      }))
    )
    controls.setMasterVolume(manifest.masterVolume)
    setImage(
      manifest.image
        ? (files.get(manifest.image.reference.localPath) ?? null)
        : null
    )
    setImageLocalPath(manifest.image?.reference.localPath)
    setSavedId(manifest.id)
    setSavedName(manifest.name)
    setSaveMessage(`Restored “${manifest.name}” from ${source}.`)
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
    void localStore
      .list()
      .then(setSavedSoundscapes)
      .catch(() => undefined)
    // Restoration runs only for this application/store instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStore])

  const buildManifest = (
    name: string,
    id: string,
    reuseStoredMedia = false
  ) => {
    const files = new Map<string, File>()
    const trackIds: string[] = []
    const uniquePath = (prefix: string, index: number, file: File) =>
      `${prefix}-${index}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const tracks = controls.tracks
      .filter((track) => track.status === 'ready')
      .map((track, index) => {
        const file = controls.getTrackFile(track.id)
        if (!file)
          throw new Error(`The media file “${track.name}” is unavailable.`)
        const localPath =
          reuseStoredMedia && track.localPath
            ? track.localPath
            : uniquePath('track', index, file)
        if (!(reuseStoredMedia && track.localPath)) files.set(localPath, file)
        trackIds.push(track.id)
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
      const localPath =
        reuseStoredMedia && imageLocalPath
          ? imageLocalPath
          : uniquePath('image', 0, image)
      if (!(reuseStoredMedia && imageLocalPath)) files.set(localPath, image)
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
      timerSettings: { ...timerSettings },
      image: manifestImage,
      tracks
    }
    return { manifest, files, trackIds }
  }

  const retainSavedMediaPaths = (
    manifest: SoundscapeManifest,
    trackIds: string[]
  ) => {
    controls.setTrackLocalPaths(
      new Map(
        manifest.tracks.map((track, index) => [
          trackIds[index],
          track.reference.localPath
        ])
      )
    )
    setImageLocalPath(manifest.image?.reference.localPath)
  }

  const suggestedSoundscapeName = async () => {
    const saved = await localStore.list().catch(() => [])
    return nextSoundscapeName(saved.map(({ name }) => name))
  }

  const refreshSavedSoundscapes = async () => {
    setSavedSoundscapes(await localStore.list())
  }

  const saveAsNew = async () => {
    const requestedName = window.prompt(
      'Soundscape name',
      await suggestedSoundscapeName()
    )
    if (requestedName === null) return
    try {
      const name = validateSoundscapeName(requestedName)
      setSaveMessage('Saving…')
      const { manifest, files, trackIds } = buildManifest(
        name,
        crypto.randomUUID()
      )
      const persistent = await localStore.requestPersistence()
      await localStore.save(manifest, files)
      retainSavedMediaPaths(manifest, trackIds)
      setSavedId(manifest.id)
      setSavedName(manifest.name)
      await refreshSavedSoundscapes()
      setSaveMessage(
        persistent
          ? `Saved “${name}” on this device.`
          : `Saved “${name}”. Your browser may clear it when storage is low.`
      )
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Saving failed.')
    }
  }

  const saveChanges = async () => {
    if (!savedId || !savedName) return
    setSaveMessage('Saving changes…')
    try {
      const { manifest, files, trackIds } = buildManifest(
        savedName,
        savedId,
        true
      )
      await localStore.save(manifest, files)
      retainSavedMediaPaths(manifest, trackIds)
      await refreshSavedSoundscapes()
      setSaveMessage(`Saved changes to “${savedName}”.`)
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Saving failed.')
    }
  }

  const deleteSaved = async (id: string) => {
    try {
      await localStore.delete(id)
      if (savedId === id) {
        setSavedId(undefined)
        setSavedName(undefined)
      }
      await refreshSavedSoundscapes()
      setSaveMessage('Deleted the local saved soundscape and its cached media.')
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : 'Deletion failed.'
      )
    }
  }

  const renameSaved = async (saved: SoundscapeManifest) => {
    const requestedName = window.prompt('Rename soundscape', saved.name)
    if (requestedName === null) return
    try {
      const renamed = await localStore.rename(
        saved.id,
        validateSoundscapeName(requestedName)
      )
      if (savedId === saved.id) setSavedName(renamed.name)
      await refreshSavedSoundscapes()
      setSaveMessage(`Renamed soundscape to “${renamed.name}”.`)
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Rename failed.')
    }
  }

  const openSaved = async (id: string) => {
    try {
      const restored = await localStore.restore(id)
      if (!restored) throw new Error('The saved soundscape no longer exists.')
      await restoreSoundscape(restored)
      localStore.setLast(id)
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Opening failed.')
    }
  }

  const driveToken = async () => {
    if (!googleDriveAuth)
      throw new Error('Google Drive is not configured for this app.')
    return googleDriveAuth.getAccessToken() ?? (await googleDriveAuth.connect())
  }

  const saveToDrive = async () => {
    const requestedName = window.prompt(
      'Soundscape name',
      await suggestedSoundscapeName()
    )
    if (requestedName === null) return
    try {
      const name = validateSoundscapeName(requestedName)
      setSaveMessage('Exporting soundscape to Google Drive…')
      const token = await driveToken()
      if (!token) {
        setSaveMessage(undefined)
        return
      }
      const { manifest, files, trackIds } = buildManifest(
        name,
        crypto.randomUUID()
      )
      await publishSoundscape(manifest, files, token)
      await localStore.save(manifest, files)
      retainSavedMediaPaths(manifest, trackIds)
      setSavedId(manifest.id)
      setSavedName(manifest.name)
      await refreshSavedSoundscapes()
      setSaveMessage(`Exported “${name}” to Google Drive.`)
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
            processed locally in your browser unless you explicitly export a
            soundscape to Google Drive.
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
              setSaveMessage('Importing soundscape from Google Drive…')
              try {
                await restoreSoundscape(
                  await importDriveSoundscape(fileId, token, localStore),
                  'Google Drive'
                )
                await refreshSavedSoundscapes()
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
            {!savedId ? (
              <button type="button" onClick={() => void saveAsNew()}>
                Save on this device
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void saveChanges()}>
                  Save changes
                </button>
                <button type="button" onClick={() => void saveAsNew()}>
                  Save as new soundscape
                </button>
              </>
            )}
            <button type="button" onClick={() => void saveToDrive()}>
              Export soundscape to Google Drive
            </button>
          </div>
          {savedId && savedName && (
            <p className="current-soundscape">
              Current soundscape: <strong>{savedName}</strong>
            </p>
          )}
          {savedSoundscapes.length > 0 && (
            <section
              className="saved-soundscapes"
              aria-labelledby="saved-title"
            >
              <h2 id="saved-title">Saved soundscapes</h2>
              <ul>
                {savedSoundscapes.map((saved) => (
                  <li key={saved.id}>
                    <span className="saved-soundscape-name" title={saved.name}>
                      {saved.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Open ${saved.name}`}
                      onClick={() => void openSaved(saved.id)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${saved.name}`}
                      onClick={() => void renameSaved(saved)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete local copy ${saved.name}`}
                      onClick={() => void deleteSaved(saved.id)}
                    >
                      Delete local copy
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {saveMessage && <p role="status">{saveMessage}</p>}
        </section>

        <section className="mixer" aria-label="Soundscape mixer">
          <SoundscapeImage
            ref={imageRef}
            image={image}
            onChoose={() => inputRef.current?.click()}
            onRemove={() => {
              setImage(null)
              setImageLocalPath(undefined)
            }}
          />
          <MeditationTimer
            key={timerSessionKey}
            settings={timerSettings}
            onSettingsChange={setTimerSettings}
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
