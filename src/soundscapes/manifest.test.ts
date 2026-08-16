import { describe, expect, it } from 'vitest'
import { nextSoundscapeName, parseSoundscapeManifest } from './manifest'

const track = {
  name: 'rain.opus',
  mimeType: 'audio/opus',
  size: 42,
  volume: 0.7,
  isSoundEffect: false,
  effectChance: 50,
  reference: { localPath: 'track-0-rain.opus' }
}

describe('soundscape manifest', () => {
  it('suggests the first available numbered soundscape name', () => {
    expect(nextSoundscapeName([])).toBe('Soundscape 1')
    expect(
      nextSoundscapeName([
        'Soundscape 1',
        'soundscape 2',
        'A custom name',
        ' Soundscape 3 '
      ])
    ).toBe('Soundscape 4')
  })

  it('migrates an unversioned manifest and supplies the default master volume', () => {
    const manifest = parseSoundscapeManifest({
      id: 'saved-id',
      name: 'Rain',
      updatedAt: '2026-08-14T00:00:00.000Z',
      tracks: [track]
    })

    expect(manifest).toMatchObject({ version: 1, masterVolume: 1 })
  })

  it('preserves track order and settings', () => {
    const second = { ...track, name: 'birds.ogg', volume: 0.2 }
    const manifest = parseSoundscapeManifest({
      version: 1,
      id: 'saved-id',
      name: 'Forest',
      updatedAt: '2026-08-14T00:00:00.000Z',
      masterVolume: 0.8,
      tracks: [track, second]
    })

    expect(manifest.tracks.map(({ name }) => name)).toEqual([
      'rain.opus',
      'birds.ogg'
    ])
    expect(manifest.tracks[1]).toMatchObject({ volume: 0.2, effectChance: 50 })
  })

  it.each([
    [{ version: 99 }, /invalid or unsupported/i],
    [
      {
        version: 1,
        id: 'id',
        name: 'Broken',
        updatedAt: 'today',
        masterVolume: 1,
        tracks: [{ ...track, volume: 'loud' }]
      },
      /invalid media metadata/i
    ]
  ])('rejects malformed or unsupported manifests', (value, message) => {
    expect(() => parseSoundscapeManifest(value)).toThrow(message)
  })
})
