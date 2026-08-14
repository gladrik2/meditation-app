import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleDriveAuth } from '../googleDrive/googleDriveAuth'
import { AudioSourceChooser } from './AudioSourceChooser'

vi.mock('@googleworkspace/drive-picker-react', () => ({
  DrivePicker: ({ onPicked, onCanceled }: Record<string, unknown>) => (
    <div data-testid="drive-picker">
      <button
        onClick={() =>
          (onPicked as (event: object) => void)({
            detail: {
              docs: [{ id: 'rain-id', name: 'rain.wav', mimeType: 'audio/wav' }]
            }
          })
        }
      >
        Pick Drive files
      </button>
      <button onClick={() => (onCanceled as () => void)()}>
        Cancel Picker
      </button>
    </div>
  ),
  DrivePickerDocsView: () => null
}))

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
  const props = { onChooseDevice: vi.fn(), onChooseDriveFiles: vi.fn() }

  afterEach(() => vi.restoreAllMocks())

  it('opens the local file input flow from the source menu', async () => {
    const user = userEvent.setup()
    const onChooseDevice = vi.fn()
    render(
      <AudioSourceChooser
        onChooseDevice={onChooseDevice}
        onChooseDriveFiles={vi.fn()}
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
    render(<AudioSourceChooser driveAuth={auth} {...props} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(auth.connect).not.toHaveBeenCalled()
    expect(screen.getByTestId('drive-picker')).toBeInTheDocument()
  })

  it('silently closes after OAuth cancellation', async () => {
    const user = userEvent.setup()
    const auth = createAuth({ connect: vi.fn().mockResolvedValue(undefined) })
    render(<AudioSourceChooser driveAuth={auth} {...props} />)

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
    render(<AudioSourceChooser driveAuth={auth} {...props} />)

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))

    expect(screen.getByText('Google sign-in failed.')).toBeInTheDocument()
  })

  it('downloads a picked file and sends it to the existing file pipeline', async () => {
    const user = userEvent.setup()
    const onChooseDriveFiles = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['audio']))
    } as unknown as Response)
    render(
      <AudioSourceChooser
        driveAuth={createAuth({
          getAccessToken: vi.fn().mockReturnValue('reused-token')
        })}
        onChooseDevice={vi.fn()}
        onChooseDriveFiles={onChooseDriveFiles}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))
    await user.click(screen.getByRole('button', { name: 'Pick Drive files' }))

    expect(onChooseDriveFiles).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'rain.wav', type: 'audio/wav' })
    ])
    expect(fetch).toHaveBeenCalledWith(
      'https://www.googleapis.com/drive/v3/files/rain-id?alt=media',
      { headers: { Authorization: 'Bearer reused-token' } }
    )
  })

  it('disables the source chooser while picked files are downloading', async () => {
    const user = userEvent.setup()
    let finishDownload: ((response: Response) => void) | undefined
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => {
        finishDownload = resolve
      })
    )
    render(
      <AudioSourceChooser
        driveAuth={createAuth({
          getAccessToken: vi.fn().mockReturnValue('token')
        })}
        {...props}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))
    await user.click(screen.getByRole('button', { name: 'Pick Drive files' }))

    expect(
      screen.getByRole('button', { name: 'From this device' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Downloading…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByTestId('drive-picker')).not.toBeInTheDocument()

    finishDownload?.({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['audio']))
    } as unknown as Response)
  })

  it('closes silently when the Picker is canceled', async () => {
    const user = userEvent.setup()
    render(
      <AudioSourceChooser
        driveAuth={createAuth({
          getAccessToken: vi.fn().mockReturnValue('token')
        })}
        {...props}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))
    await user.click(screen.getByRole('button', { name: 'Cancel Picker' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/error|failed/i)).not.toBeInTheDocument()
  })

  it('surfaces a Drive download failure', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 403
    } as unknown as Response)
    render(
      <AudioSourceChooser
        driveAuth={createAuth({
          getAccessToken: vi.fn().mockReturnValue('token')
        })}
        {...props}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Add files' }))
    await user.click(screen.getByRole('button', { name: 'From Google Drive' }))
    await user.click(screen.getByRole('button', { name: 'Pick Drive files' }))

    expect(
      await screen.findByText(/Could not download “rain.wav”.*403/)
    ).toBeInTheDocument()
  })
})
