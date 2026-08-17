export const SOUNDSCAPE_MANIFEST_VERSION = 1 as const
export const SOUNDSCAPE_NAME_MAX_LENGTH = 80

export function validateSoundscapeName(value: string) {
  if (/\p{Cc}/u.test(value))
    throw new Error('Soundscape names cannot contain control characters.')
  const name = value.trim()
  if (!name) throw new Error('Enter a soundscape name.')
  if ([...name].length > SOUNDSCAPE_NAME_MAX_LENGTH)
    throw new Error(
      `Soundscape names must be ${SOUNDSCAPE_NAME_MAX_LENGTH} characters or fewer.`
    )
  return name
}

export interface MediaReference {
  localPath: string
  driveFileId?: string
  driveModifiedTime?: string
  driveSize?: string
  driveChecksum?: string
}

export interface ManifestMedia {
  name: string
  mimeType: string
  size: number
  reference: MediaReference
}

export interface ManifestTrack extends ManifestMedia {
  volume: number
  isSoundEffect: boolean
  effectChance: number
}

export interface SoundscapeManifest {
  version: typeof SOUNDSCAPE_MANIFEST_VERSION
  id: string
  name: string
  updatedAt: string
  masterVolume: number
  image?: ManifestMedia
  tracks: ManifestTrack[]
}

export function nextSoundscapeName(existingNames: Iterable<string>) {
  const taken = new Set(
    [...existingNames].map((name) => name.trim().toLocaleLowerCase())
  )
  let number = 1
  while (taken.has(`soundscape ${number}`)) number += 1
  return `Soundscape ${number}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function parseSoundscapeManifest(value: unknown): SoundscapeManifest {
  if (!isRecord(value)) throw new Error('The soundscape manifest is invalid.')
  const migrated =
    value.version === undefined
      ? { ...value, version: 1, masterVolume: value.masterVolume ?? 1 }
      : value
  if (
    migrated.version !== SOUNDSCAPE_MANIFEST_VERSION ||
    typeof migrated.id !== 'string' ||
    typeof migrated.name !== 'string' ||
    typeof migrated.updatedAt !== 'string' ||
    typeof migrated.masterVolume !== 'number' ||
    !Array.isArray(migrated.tracks)
  )
    throw new Error('The soundscape manifest is invalid or unsupported.')

  const validateMedia = (media: unknown): media is ManifestMedia =>
    isRecord(media) &&
    typeof media.name === 'string' &&
    typeof media.mimeType === 'string' &&
    typeof media.size === 'number' &&
    isRecord(media.reference) &&
    typeof media.reference.localPath === 'string'
  const tracksValid = migrated.tracks.every((track) => {
    if (!validateMedia(track)) return false
    const candidate = track as ManifestMedia & Record<string, unknown>
    return (
      typeof candidate.volume === 'number' &&
      typeof candidate.isSoundEffect === 'boolean' &&
      typeof candidate.effectChance === 'number'
    )
  })
  if (!tracksValid || (migrated.image && !validateMedia(migrated.image)))
    throw new Error('The soundscape manifest contains invalid media metadata.')
  return migrated as unknown as SoundscapeManifest
}
