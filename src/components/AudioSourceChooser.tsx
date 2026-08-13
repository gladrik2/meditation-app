import { useState } from 'react'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import type { GoogleDrivePicker } from '../googleDrive/googleDrivePicker'

interface AudioSourceChooserProps {
  driveAuth?: GoogleDriveAuth
  drivePicker?: GoogleDrivePicker
  onChooseFiles(files: File[]): void
  onChooseDevice(): void
}

export function AudioSourceChooser({
  driveAuth,
  drivePicker,
  onChooseFiles,
  onChooseDevice
}: AudioSourceChooserProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const close = () => {
    if (busy) return
    setOpen(false)
    setError(undefined)
  }

  const chooseDrive = async () => {
    if (!driveAuth || !drivePicker) {
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
      const files = await drivePicker.pickFiles(token)
      if (!files) {
        setOpen(false)
        return
      }
      onChooseFiles(files)
      setOpen(false)
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
    </>
  )
}
