import {
  parseSoundscapeManifest,
  type SoundscapeManifest
} from '../soundscapes/manifest'
import type { LocalSoundscapeStore } from '../soundscapes/localSoundscapes'

const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const headers = (token: string) => ({ Authorization: `Bearer ${token}` })

async function upload(
  name: string,
  mimeType: string,
  body: Blob,
  parentId: string,
  token: string,
  fetcher: typeof fetch
) {
  const start = await fetcher(`${UPLOAD}?uploadType=resumable`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType, parents: [parentId] })
  })
  if (!start.ok) throw new Error(`Could not start uploading “${name}”.`)
  const location = start.headers.get('Location')
  if (!location) throw new Error('Google Drive did not provide an upload URL.')
  const result = await fetcher(location, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body
  })
  if (!result.ok) throw new Error(`Could not upload “${name}”.`)
  return (await result.json()) as { id: string }
}

export async function publishSoundscape(
  manifest: SoundscapeManifest,
  files: Map<string, File>,
  token: string,
  fetcher: typeof fetch = fetch
) {
  const folderResponse = await fetcher(API, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: manifest.name,
      mimeType: 'application/vnd.google-apps.folder'
    })
  })
  if (!folderResponse.ok) throw new Error('Could not create the Drive folder.')
  const folder = (await folderResponse.json()) as { id: string }
  const media = [
    ...(manifest.image ? [manifest.image] : []),
    ...manifest.tracks
  ]
  for (const item of media) {
    const file = files.get(item.reference.localPath)
    if (!file) throw new Error(`The media file “${item.name}” is unavailable.`)
    const uploaded = await upload(
      item.name,
      item.mimeType,
      file,
      folder.id,
      token,
      fetcher
    )
    item.reference.driveFileId = uploaded.id
  }
  await upload(
    'soundscape.json',
    'application/json',
    new Blob([JSON.stringify(manifest)], { type: 'application/json' }),
    folder.id,
    token,
    fetcher
  )
  return folder.id
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length) {
        const index = next++
        results[index] = await task(values[index])
      }
    })
  )
  return results
}

interface DriveMetadata {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  md5Checksum?: string
}

export async function importDriveSoundscape(
  manifestFileId: string,
  token: string,
  store: LocalSoundscapeStore,
  fetcher: typeof fetch = fetch
) {
  const manifestResponse = await fetcher(
    `${API}/${encodeURIComponent(manifestFileId)}?alt=media`,
    { headers: headers(token) }
  )
  if (!manifestResponse.ok)
    throw new Error('Could not download soundscape.json.')
  const manifest = parseSoundscapeManifest(await manifestResponse.json())
  const cached = await store.restore(manifest.id).catch(() => undefined)
  const media = [
    ...(manifest.image ? [manifest.image] : []),
    ...manifest.tracks
  ]
  const downloaded = await mapWithConcurrency(media, 3, async (item) => {
    const id = item.reference.driveFileId
    if (!id) throw new Error(`“${item.name}” has no Google Drive file ID.`)
    const metadataResponse = await fetcher(
      `${API}/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,md5Checksum`,
      { headers: headers(token) }
    )
    if (!metadataResponse.ok)
      throw new Error(`Could not check “${item.name}” on Google Drive.`)
    const metadata = (await metadataResponse.json()) as DriveMetadata
    const reference = item.reference
    const unchanged =
      cached?.files.has(reference.localPath) &&
      reference.driveModifiedTime === metadata.modifiedTime &&
      reference.driveSize === metadata.size &&
      (!reference.driveChecksum ||
        reference.driveChecksum === metadata.md5Checksum)
    if (unchanged)
      return [
        reference.localPath,
        cached!.files.get(reference.localPath)!
      ] as const
    const response = await fetcher(
      `${API}/${encodeURIComponent(id)}?alt=media`,
      {
        headers: headers(token)
      }
    )
    if (!response.ok) throw new Error(`Could not download “${item.name}”.`)
    reference.driveModifiedTime = metadata.modifiedTime
    reference.driveSize = metadata.size
    reference.driveChecksum = metadata.md5Checksum
    return [
      reference.localPath,
      new File([await response.blob()], item.name, { type: item.mimeType })
    ] as const
  })
  const files = new Map<string, File>(downloaded)
  await store.save(manifest, files)
  return { manifest, files }
}
