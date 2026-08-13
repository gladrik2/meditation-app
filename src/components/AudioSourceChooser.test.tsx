import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import type { GoogleDrivePicker } from '../googleDrive/googleDrivePicker'
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

function createPicker(
  overrides: Partial<GoogleDrivePicker> = {}
): GoogleDrivePicker {
  return {
    pickFiles: vi.fn().mockResolvedValue([]),
    ...overrides
  }
}

describe('AudioSourceChooser', () => {
  it('opens the local file input flow from the source menu', async () => {
    const user = userEvent.setup()
    const onChooseDevice = vi.fn()
    render(
      <AudioSourceChooser
        onChooseDevice={onChooseDevice}
        onChooseFiles={vi.fn()}
      />
    )

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
    const picker = createPicker()
    render(
      <AudioSourceChooser
        driveAuth={auth}
        drivePicker={picker}
        onChooseDevice={vi.fn()}
        onChooseFiles={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(auth.connect).not.toHaveBeenCalled()
    expect(picker.pickFiles).toHaveBeenCalledWith('valid')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('silently closes after Picker cancellation', async () => {
    const user = userEvent.setup()
    const auth = createAuth()
    const picker = createPicker({
      pickFiles: vi.fn().mockResolvedValue(undefined)
    })
    render(
      <AudioSourceChooser
        driveAuth={auth}
        drivePicker={picker}
        onChooseDevice={vi.fn()}
        onChooseFiles={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(screen.queryByText(/cancelled/i)).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows real authorization failures', async () => {
    const user = userEvent.setup()
    const auth = createAuth({
      connect: vi.fn().mockRejectedValue(new Error('Google sign-in failed.'))
    })
    render(
      <AudioSourceChooser
        driveAuth={auth}
        drivePicker={createPicker()}
        onChooseDevice={vi.fn()}
        onChooseFiles={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(screen.getByText('Google sign-in failed.')).toBeInTheDocument()
  })

  it('passes downloaded Picker files to the existing file pipeline', async () => {
    const user = userEvent.setup()
    const files = [
      new File(['audio'], 'rain.wav', { type: 'audio/wav' }),
      new File(['image'], 'forest.jpg', { type: 'image/jpeg' })
    ]
    const onChooseFiles = vi.fn()
    render(
      <AudioSourceChooser
        driveAuth={createAuth()}
        drivePicker={createPicker({
          pickFiles: vi.fn().mockResolvedValue(files)
        })}
        onChooseDevice={vi.fn()}
        onChooseFiles={onChooseFiles}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(onChooseFiles).toHaveBeenCalledWith(files)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows Drive download failures without closing the source menu', async () => {
    const user = userEvent.setup()
    render(
      <AudioSourceChooser
        driveAuth={createAuth()}
        drivePicker={createPicker({
          pickFiles: vi
            .fn()
            .mockRejectedValue(
              new Error(
                'Could not download “rain.wav” from Google Drive (403).'
              )
            )
        })}
        onChooseDevice={vi.fn()}
        onChooseFiles={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(
      screen.getByText('Could not download “rain.wav” from Google Drive (403).')
    ).toBeInTheDocument()
  })
})
