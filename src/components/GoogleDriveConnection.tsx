import { useState } from 'react'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'

interface GoogleDriveConnectionProps {
  auth?: GoogleDriveAuth
}

export function GoogleDriveConnection({ auth }: GoogleDriveConnectionProps) {
  const [connected, setConnected] = useState(auth?.isConnected() ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (!auth) {
    return (
      <aside className="drive-connection" aria-label="Google Drive connection">
        <div>
          <strong>Google Drive</strong>
          <p>Not configured. Local files remain available.</p>
        </div>
      </aside>
    )
  }

  const connect = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await auth.connect()
      setConnected(true)
    } catch (caught) {
      setConnected(false)
      setError(
        caught instanceof Error
          ? caught.message
          : 'Google Drive authorization could not be completed.'
      )
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(undefined)
    await auth.disconnect()
    setConnected(false)
    setBusy(false)
  }

  return (
    <aside className="drive-connection" aria-label="Google Drive connection">
      <div>
        <strong>Google Drive</strong>
        <p role="status">{connected ? 'Connected' : 'Not connected'}</p>
        {error && <p className="drive-error">{error}</p>}
      </div>
      <button
        type="button"
        className="secondary-control"
        disabled={busy}
        onClick={() => void (connected ? disconnect() : connect())}
      >
        {busy ? 'Please wait…' : connected ? 'Disconnect' : 'Connect'}
      </button>
    </aside>
  )
}
