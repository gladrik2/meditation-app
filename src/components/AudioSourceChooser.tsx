import { useState } from 'react'
import {
  DrivePicker,
  DrivePickerDocsView
} from '@googleworkspace/drive-picker-react'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import {
  downloadGoogleDriveFiles,
  type GoogleDriveDocument
} from '../googleDrive/googleDriveFiles'

const GOOGLE_DRIVE_APP_ID = '628795874681'

interface AudioSourceChooserProps {
  driveAuth?: GoogleDriveAuth
  onChooseDevice(): void
  onChooseDriveFiles(files: File[]): void | Promise<void>
  onOpenDriveSoundscape?(
    fileId: string,
    accessToken: string
  ): void | Promise<void>
}

export function AudioSourceChooser({
  driveAuth,
  onChooseDevice,
  onChooseDriveFiles,
  onOpenDriveSoundscape
}: AudioSourceChooserProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string>()
  const [pickerToken, setPickerToken] = useState<string>()
  const [pickerPurpose, setPickerPurpose] = useState<'media' | 'manifest'>(
    'media'
  )

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(undefined)
    setDownloading(false)
  }

  const chooseDrive = async (purpose: 'media' | 'manifest' = 'media') => {
    if (!driveAuth) {
      setError('Google Drive is not configured for this app.')
      return
    }

    setBusy(true)
    setError(undefined)
    try {
      const token = driveAuth.getAccessToken() ?? (await driveAuth.connect())
      if (!token) {
        setOpen(false)
        return
      }
      setPickerPurpose(purpose)
      setPickerToken(token)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Google Drive authorization could not be completed.'
      )
    } finally {
      setBusy(false)
    }
  }

  const pickerFailed = (caught: unknown) => {
    const oauthDescription =
      typeof caught === 'object' && caught && 'error_description' in caught
        ? String(caught.error_description)
        : undefined
    setPickerToken(undefined)
    setOpen(true)
    setError(
      oauthDescription ??
        (caught instanceof Error
          ? caught.message
          : 'Google Drive files could not be added.')
    )
    setBusy(false)
    setDownloading(false)
  }

  return (
    <>
      <button
        className="choose-button"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">＋</span> Add files
      </button>
      {open && (
        <div className="source-chooser-backdrop" onMouseDown={close}>
          <div
            aria-labelledby="source-chooser-title"
            aria-modal="true"
            className="source-chooser"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close()
            }}
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 id="source-chooser-title">Add files</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                onChooseDevice()
              }}
            >
              From this device
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void chooseDrive()}
            >
              {downloading
                ? 'Downloading…'
                : busy
                  ? 'Connecting…'
                  : 'From Google Drive'}
            </button>
            {onOpenDriveSoundscape && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseDrive('manifest')}
              >
                Open saved soundscape from Google Drive
              </button>
            )}
            {error && <p className="source-chooser-error">{error}</p>}
            <button
              className="source-chooser-cancel"
              type="button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {pickerToken && (
        <DrivePicker
          app-id={GOOGLE_DRIVE_APP_ID}
          oauth-token={pickerToken}
          multiselect={pickerPurpose === 'media'}
          onCanceled={() => {
            setPickerToken(undefined)
            setOpen(false)
            setBusy(false)
          }}
          onPicked={(event) => {
            const documents = (event.detail.docs ?? []) as GoogleDriveDocument[]
            setPickerToken(undefined)
            setBusy(true)
            setDownloading(true)
            const operation =
              pickerPurpose === 'manifest'
                ? onOpenDriveSoundscape?.(documents[0]?.id ?? '', pickerToken)
                : downloadGoogleDriveFiles(documents, pickerToken).then(
                    onChooseDriveFiles
                  )
            void Promise.resolve(operation)
              .then(() => {
                setPickerToken(undefined)
                setOpen(false)
                setBusy(false)
                setDownloading(false)
              })
              .catch(pickerFailed)
          }}
          onOauthError={(event) => pickerFailed(event.detail)}
        >
          <DrivePickerDocsView
            include-folders="false"
            select-folder-enabled="false"
            mime-types={
              pickerPurpose === 'manifest' ? 'application/json' : undefined
            }
          />
        </DrivePicker>
      )}
    </>
  )
}
