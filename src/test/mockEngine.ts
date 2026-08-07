import { vi } from 'vitest'
import type { AudioEngine } from '../audio/types'

export function createMockEngine(): AudioEngine {
  return {
    loadTrack: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    playAll: vi.fn().mockResolvedValue(undefined),
    stopAll: vi.fn(),
    setTrackVolume: vi.fn(),
    setMasterVolume: vi.fn(),
    removeTrack: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined)
  }
}
