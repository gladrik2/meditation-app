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
}

export function AudioSourceChooser({
  driveAuth,
  onChooseDevice,
  onChooseDriveFiles
}: AudioSourceChooserProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [pickerToken, setPickerToken] = useState<string>()

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(undefined)
  }

  const chooseDrive = async () => {
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
              {busy ? 'Connecting…' : 'From Google Drive'}
            </button>
            {error && <p className="source-chooser-error">{error}</p>}
            <button
              className="source-chooser-cancel"
              type="button"
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
          multiselect
          onCanceled={() => {
            setPickerToken(undefined)
            setOpen(false)
            setBusy(false)
          }}
          onPicked={(event) => {
            const documents = (event.detail.docs ?? []) as GoogleDriveDocument[]
            void downloadGoogleDriveFiles(documents, pickerToken)
              .then(onChooseDriveFiles)
              .then(() => {
                setPickerToken(undefined)
                setOpen(false)
                setBusy(false)
              })
              .catch(pickerFailed)
          }}
          onOauthError={(event) => pickerFailed(event.detail)}
        >
          <DrivePickerDocsView
            include-folders="false"
            select-folder-enabled="false"
          />
        </DrivePicker>
      )}
    </>
  )
}
