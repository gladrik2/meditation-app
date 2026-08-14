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
  const start = await fetcher(
    `${UPLOAD}?uploadType=resumable&fields=id,modifiedTime,size,md5Checksum`,
    {
      method: 'POST',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parentId] })
    }
  )
  if (!start.ok) throw new Error(`Could not start uploading “${name}”.`)
  const location = start.headers.get('Location')
  if (!location) throw new Error('Google Drive did not provide an upload URL.')
  const result = await fetcher(location, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body
  })
  if (!result.ok) throw new Error(`Could not upload “${name}”.`)
  return (await result.json()) as DriveMetadata
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
    item.reference.driveModifiedTime = uploaded.modifiedTime
    item.reference.driveSize = uploaded.size
    item.reference.driveChecksum = uploaded.md5Checksum
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
  let failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (next < values.length && failure === undefined) {
        const index = next++
        try {
          results[index] = await task(values[index])
        } catch (error) {
          failure = error
        }
      }
    })
  )
  if (failure !== undefined) throw failure
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
  const cachedByDriveId = new Map(
    [
      ...(cached?.manifest.image ? [cached.manifest.image] : []),
      ...(cached?.manifest.tracks ?? [])
    ]
      .filter((item) => item.reference.driveFileId)
      .map((item) => [item.reference.driveFileId, item] as const)
  )
  const media = [
    ...(manifest.image ? [manifest.image] : []),
    ...manifest.tracks
  ]
  const stagedPaths: string[] = []
  try {
    await mapWithConcurrency(media, 3, async (item) => {
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
      const cachedItem = cachedByDriveId.get(id)
      const cachedReference = cachedItem?.reference
      const unchanged =
        cachedReference &&
        cached?.files.has(cachedReference.localPath) &&
        cachedReference.driveModifiedTime === metadata.modifiedTime &&
        cachedReference.driveSize === metadata.size &&
        (!cachedReference.driveChecksum ||
          cachedReference.driveChecksum === metadata.md5Checksum)
      reference.driveModifiedTime = metadata.modifiedTime
      reference.driveSize = metadata.size
      reference.driveChecksum = metadata.md5Checksum
      if (unchanged) {
        reference.localPath = cachedReference.localPath
        return
      }
      const response = await fetcher(
        `${API}/${encodeURIComponent(id)}?alt=media`,
        {
          headers: headers(token)
        }
      )
      if (!response.ok) throw new Error(`Could not download “${item.name}”.`)
      if (!response.body)
        throw new Error(`Google Drive returned no data for “${item.name}”.`)
      reference.localPath = await store.writeMedia(
        manifest.id,
        reference.localPath,
        response.body
      )
      stagedPaths.push(reference.localPath)
    })
    await store.commitManifest(manifest)
  } catch (error) {
    await store.removeMedia(manifest.id, stagedPaths)
    throw error
  }
  const restored = await store.restore(manifest.id)
  if (!restored)
    throw new Error('The imported soundscape cache is unavailable.')
  return restored
}
