import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import { AudioSourceChooser } from './AudioSourceChooser'

function createAuth(overrides: Partial<GoogleDriveAuth> = {}): GoogleDriveAuth {
  return {
    connect: vi.fn().mockResolvedValue('access-token'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockReturnValue(undefined),
    isConnected: vi.fn().mockReturnValue(false),
    ...overrides
  }
}

describe('AudioSourceChooser', () => {
  it('opens the local file input flow from the source menu', async () => {
    const user = userEvent.setup()
    const onChooseDevice = vi.fn()
    render(<AudioSourceChooser onChooseDevice={onChooseDevice} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From this device' }))

    expect(onChooseDevice).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reuses a valid Drive token without reconnecting', async () => {
    const user = userEvent.setup()
    const auth = createAuth({
      getAccessToken: vi.fn().mockReturnValue('valid')
    })
    render(<AudioSourceChooser driveAuth={auth} onChooseDevice={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(auth.connect).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('silently closes after OAuth cancellation', async () => {
    const user = userEvent.setup()
    const auth = createAuth({ connect: vi.fn().mockResolvedValue(undefined) })
    render(<AudioSourceChooser driveAuth={auth} onChooseDevice={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(screen.queryByText(/authorization was cancelled/i)).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows real authorization failures', async () => {
    const user = userEvent.setup()
    const auth = createAuth({
      connect: vi.fn().mockRejectedValue(new Error('Google sign-in failed.'))
    })
    render(<AudioSourceChooser driveAuth={auth} onChooseDevice={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(screen.getByText('Google sign-in failed.')).toBeInTheDocument()
  })
})
