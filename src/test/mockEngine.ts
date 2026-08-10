import { vi } from 'vitest'
import type {
  AudioEngine,
  AudioTransportEvent,
  AudioTransportListener
} from '../audio/types'

export interface MockAudioEngine extends AudioEngine {
  emit: (event: AudioTransportEvent) => void
}

export function createMockEngine(): MockAudioEngine {
  const listeners = new Set<AudioTransportListener>()
  const playingIds = new Set<string>()
  const emit = (event: AudioTransportEvent) => {
    if (event.state === 'playing') playingIds.add(event.id)
    else playingIds.delete(event.id)
    for (const listener of listeners) listener(event)
  }
  const engine: MockAudioEngine = {
    prepareTimerCue: vi.fn().mockResolvedValue(undefined),
    playTimerCue: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener: AudioTransportListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    loadTrack: vi.fn().mockResolvedValue(20),
    play: vi.fn(async (id: string) => emit({ id, state: 'playing' })),
    pause: vi.fn((id: string) => emit({ id, state: 'paused' })),
    playAll: vi.fn(async (ids: string[]) => {
      for (const id of ids) emit({ id, state: 'playing' })
    }),
    stopAll: vi.fn(() => {
      for (const id of [...playingIds]) emit({ id, state: 'paused' })
    }),
    setTrackLoop: vi.fn(),
    setTrackVolume: vi.fn(),
    setMasterVolume: vi.fn(),
    removeTrack: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    emit
  }
  return engine
}
