const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata'
] as const

interface TokenResponse {
  access_token?: string
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void
}

interface GoogleIdentityServices {
  accounts: {
    oauth2: {
      initTokenClient(options: {
        client_id: string
        scope: string
        callback: (response: TokenResponse) => void
        error_callback: (error: { type?: string }) => void
      }): TokenClient
      revoke(token: string, callback: () => void): void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentityServices
  }
}

let scriptPromise: Promise<GoogleIdentityServices> | undefined

export function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  if (window.google?.accounts.oauth2) return Promise.resolve(window.google)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_URL}"]`
    )
    const script = existing ?? document.createElement('script')

    const fail = () => {
      scriptPromise = undefined
      reject(new Error('Google sign-in could not be loaded. Please try again.'))
    }
    const load = () => {
      if (window.google?.accounts.oauth2) resolve(window.google)
      else fail()
    }

    script.addEventListener('load', load, { once: true })
    script.addEventListener('error', fail, { once: true })
    if (!existing) {
      script.src = GIS_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })

  return scriptPromise
}

export interface GoogleDriveAuth {
  connect(): Promise<void>
  disconnect(): Promise<void>
  isConnected(): boolean
}

export class BrowserGoogleDriveAuth implements GoogleDriveAuth {
  private accessToken: string | undefined

  constructor(private readonly clientId: string) {}

  isConnected() {
    return this.accessToken !== undefined
  }

  async connect() {
    const google = await loadGoogleIdentityServices()

    await new Promise<void>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: GOOGLE_DRIVE_SCOPES.join(' '),
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(
              new Error(
                response.error_description ??
                  'Google Drive authorization was cancelled or denied.'
              )
            )
            return
          }
          this.accessToken = response.access_token
          resolve()
        },
        error_callback: (error) => {
          const cancelled = error.type === 'popup_closed'
          reject(
            new Error(
              cancelled
                ? 'Google Drive authorization was cancelled.'
                : 'Google Drive authorization could not be completed.'
            )
          )
        }
      })

      client.requestAccessToken({ prompt: '' })
    })
  }

  async disconnect() {
    const token = this.accessToken
    this.accessToken = undefined
    if (!token || !window.google?.accounts.oauth2) return

    await new Promise<void>((resolve) => {
      window.google?.accounts.oauth2.revoke(token, resolve)
    })
  }
}
