import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import { AudioSourceChooser } from './AudioSourceChooser'

vi.mock('@googleworkspace/drive-picker-react', () => ({
  DrivePicker: ({ onPicked, onCanceled }: Record<string, unknown>) => (
    <div data-testid="drive-picker">
      <button
        onClick={() =>
          (onPicked as (event: object) => void)({
            detail: { docs: [{ id: 'manifest-id', name: 'soundscape.json' }] }
          })
        }
      >
        Pick manifest
      </button>
      <button onClick={() => (onCanceled as () => void)()}>
        Cancel Picker
      </button>
    </div>
  ),
  DrivePickerDocsView: () => null
}))

const auth = (overrides: Partial<GoogleDriveAuth> = {}): GoogleDriveAuth => ({
  connect: vi.fn().mockResolvedValue('new-token'),
  disconnect: vi.fn(),
  getAccessToken: vi.fn().mockReturnValue(undefined),
  isConnected: vi.fn().mockReturnValue(false),
  ...overrides
})

describe('AudioSourceChooser', () => {
  it('keeps the local file flow unchanged', async () => {
    const user = userEvent.setup()
    const onChooseDevice = vi.fn()
    render(
      <AudioSourceChooser
        onChooseDevice={onChooseDevice}
        onOpenDriveSoundscape={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From this device' }))
    expect(onChooseDevice).toHaveBeenCalledOnce()
  })

  it('offers only saved-soundscape Drive import and reuses its token', async () => {
    const user = userEvent.setup()
    const driveAuth = auth({
      getAccessToken: vi.fn().mockReturnValue('cached')
    })
    render(
      <AudioSourceChooser
        driveAuth={driveAuth}
        onChooseDevice={vi.fn()}
        onOpenDriveSoundscape={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    expect(
      screen.queryByRole('button', { name: 'From Google Drive' })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'Import soundscape from Google Drive'
      })
    )
    expect(driveAuth.connect).not.toHaveBeenCalled()
    expect(screen.getByTestId('drive-picker')).toBeInTheDocument()
  })

  it('passes the one selected manifest and token to the import flow', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    render(
      <AudioSourceChooser
        driveAuth={auth({ getAccessToken: vi.fn().mockReturnValue('token') })}
        onChooseDevice={vi.fn()}
        onOpenDriveSoundscape={open}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: /Import soundscape/ }))
    await user.click(screen.getByRole('button', { name: 'Pick manifest' }))
    expect(open).toHaveBeenCalledWith('manifest-id', 'token')
  })

  it('closes silently when OAuth or Picker is canceled', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <AudioSourceChooser
        driveAuth={auth({ connect: vi.fn().mockResolvedValue(undefined) })}
        onChooseDevice={vi.fn()}
        onOpenDriveSoundscape={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: /Import soundscape/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(
      <AudioSourceChooser
        driveAuth={auth({ getAccessToken: vi.fn().mockReturnValue('token') })}
        onChooseDevice={vi.fn()}
        onOpenDriveSoundscape={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: /Import soundscape/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel Picker' }))
    expect(screen.queryByText(/failed|error/i)).not.toBeInTheDocument()
  })

  it('surfaces import failures and unlocks the chooser', async () => {
    const user = userEvent.setup()
    render(
      <AudioSourceChooser
        driveAuth={auth({ getAccessToken: vi.fn().mockReturnValue('token') })}
        onChooseDevice={vi.fn()}
        onOpenDriveSoundscape={vi
          .fn()
          .mockRejectedValue(new Error('Drive transfer was interrupted.'))}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: /Import soundscape/ }))
    await user.click(screen.getByRole('button', { name: 'Pick manifest' }))
    expect(
      await screen.findByText('Drive transfer was interrupted.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Import soundscape/ })
    ).toBeEnabled()
  })
})
