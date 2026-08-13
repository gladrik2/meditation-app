import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserGoogleDriveAuth, GOOGLE_DRIVE_SCOPES } from './googleDriveAuth'

describe('BrowserGoogleDriveAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete window.google
  })

  function installGoogleMock(granted = true) {
    let callback: ((response: object) => void) | undefined
    const hasGrantedAllScopes = vi.fn().mockReturnValue(granted)
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((options) => {
            callback = options.callback
            return { requestAccessToken: vi.fn() }
          }),
          revoke: vi.fn((_token, done) => done()),
          hasGrantedAllScopes
        }
      }
    }
    return {
      respond: (response: object) => callback?.(response),
      hasGrantedAllScopes
    }
  }

  it('returns and exposes a token only until it expires', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const google = installGoogleMock()
    const auth = new BrowserGoogleDriveAuth('client-id')
    const connection = auth.connect()
    await Promise.resolve()

    google.respond({ access_token: 'token', expires_in: 60 })

    await expect(connection).resolves.toBe('token')
    expect(auth.getAccessToken()).toBe('token')
    expect(auth.isConnected()).toBe(true)
    expect(google.hasGrantedAllScopes).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'token' }),
      ...GOOGLE_DRIVE_SCOPES
    )

    vi.mocked(Date.now).mockReturnValue(61_000)
    expect(auth.getAccessToken()).toBeUndefined()
    expect(auth.isConnected()).toBe(false)
  })

  it('rejects partial scope grants and does not report a connection', async () => {
    const google = installGoogleMock(false)
    const auth = new BrowserGoogleDriveAuth('client-id')
    const connection = auth.connect()
    await Promise.resolve()

    google.respond({ access_token: 'partial-token', expires_in: 60 })

    await expect(connection).rejects.toThrow(
      /permission to open selected files/i
    )
    expect(auth.getAccessToken()).toBeUndefined()
    expect(auth.isConnected()).toBe(false)
  })

  it('returns an explicit empty result when the OAuth popup is closed', async () => {
    let errorCallback: ((error: { type?: string }) => void) | undefined
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: vi.fn((options) => {
            errorCallback = options.error_callback
            return { requestAccessToken: vi.fn() }
          }),
          revoke: vi.fn(),
          hasGrantedAllScopes: vi.fn()
        }
      }
    }
    const auth = new BrowserGoogleDriveAuth('client-id')
    const connection = auth.connect()
    await Promise.resolve()

    errorCallback?.({ type: 'popup_closed' })

    await expect(connection).resolves.toBeUndefined()
    expect(auth.isConnected()).toBe(false)
  })
})
