import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import { GoogleDriveConnection } from './GoogleDriveConnection'

function createAuth(overrides: Partial<GoogleDriveAuth> = {}): GoogleDriveAuth {
  return {
    connect: vi.fn().mockResolvedValue('access-token'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
    getAccessToken: vi.fn().mockReturnValue(undefined),
    ...overrides
  }
}

describe('GoogleDriveConnection', () => {
  it('keeps the optional integration inactive when it is not configured', () => {
    render(<GoogleDriveConnection />)

    expect(screen.getByText(/not configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('connects and disconnects Google Drive', async () => {
    const user = userEvent.setup()
    const auth = createAuth()
    render(<GoogleDriveConnection auth={auth} />)

    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(auth.connect).toHaveBeenCalledOnce()
    expect(screen.getByText('Connected')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(auth.disconnect).toHaveBeenCalledOnce()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('shows a clean authorization error and remains disconnected', async () => {
    const user = userEvent.setup()
    const auth = createAuth({
      connect: vi
        .fn()
        .mockRejectedValue(
          new Error('Google Drive authorization was cancelled.')
        )
    })
    render(<GoogleDriveConnection auth={auth} />)

    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(
      screen.getByText('Google Drive authorization was cancelled.')
    ).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  })
})
