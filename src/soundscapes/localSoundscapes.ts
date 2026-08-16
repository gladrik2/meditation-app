import { parseSoundscapeManifest, type SoundscapeManifest } from './manifest'

const DATABASE = 'local-soundscape-manifests'
const STORE = 'soundscapes'
const LAST_KEY = 'last-soundscape-id'

interface StoredManifest {
  id: string
  manifest: SoundscapeManifest
}

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const transaction = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
) => {
  const database = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const idbTransaction = database.transaction(STORE, mode)
    const request = run(idbTransaction.objectStore(STORE))
    let result: T
    request.onsuccess = () => {
      result = request.result
    }
    idbTransaction.oncomplete = () => resolve(result)
    idbTransaction.onerror = () => reject(idbTransaction.error ?? request.error)
    idbTransaction.onabort = () => reject(idbTransaction.error ?? request.error)
  }).finally(() => database.close())
}

const mediaFiles = (manifest: SoundscapeManifest) => [
  ...(manifest.image ? [manifest.image] : []),
  ...manifest.tracks
]

const localStorageFailure = (error: unknown) =>
  error instanceof DOMException
    ? new Error(
        'Local browser storage could not read or write a media file. Try again or replace the affected file.',
        { cause: error }
      )
    : error

export class LocalSoundscapeStore {
  async requestPersistence() {
    return (await navigator.storage?.persist?.()) ?? false
  }

  private async root() {
    if (!navigator.storage?.getDirectory)
      throw new Error('Saved soundscapes are not supported by this browser.')
    return navigator.storage.getDirectory()
  }

  async save(manifest: SoundscapeManifest, files: Map<string, File>) {
    const stagedPaths: string[] = []
    try {
      for (const media of mediaFiles(manifest)) {
        const requestedPath = media.reference.localPath
        const file = files.get(requestedPath)
        // No File means the manifest deliberately reuses existing OPFS media.
        if (!file) continue
        media.reference.localPath = await this.writeMedia(
          manifest.id,
          requestedPath,
          file.stream()
        )
        stagedPaths.push(media.reference.localPath)
      }
      await this.commitManifest(manifest)
    } catch (error) {
      await this.removeMedia(manifest.id, stagedPaths)
      throw localStorageFailure(error)
    }
  }

  async writeMedia(
    soundscapeId: string,
    localPath: string,
    stream: ReadableStream<Uint8Array>
  ) {
    const directory = await (
      await this.root()
    ).getDirectoryHandle(soundscapeId, {
      create: true
    })
    const temporaryPath = `${localPath}.${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.media`
    try {
      const temporary = await directory.getFileHandle(temporaryPath, {
        create: true
      })
      await stream.pipeTo(await temporary.createWritable())
      return temporaryPath
    } catch (error) {
      await directory.removeEntry(temporaryPath).catch(() => undefined)
      throw error
    }
  }

  async commitManifest(manifest: SoundscapeManifest) {
    const previous = await transaction<StoredManifest | undefined>(
      'readonly',
      (store) => store.get(manifest.id)
    )
    const currentPaths = new Set(
      mediaFiles(manifest).map((media) => media.reference.localPath)
    )
    await transaction('readwrite', (store) =>
      store.put({ id: manifest.id, manifest } satisfies StoredManifest)
    )
    try {
      localStorage.setItem(LAST_KEY, manifest.id)
    } catch {
      // The manifest itself is committed; failure to update the convenience
      // pointer must not roll back or delete its media.
    }
    if (previous) {
      const directory = await this.root()
        .then((root) => root.getDirectoryHandle(manifest.id))
        .catch(() => undefined)
      if (!directory) return
      for (const oldMedia of mediaFiles(previous.manifest)) {
        if (!currentPaths.has(oldMedia.reference.localPath))
          await directory
            .removeEntry(oldMedia.reference.localPath)
            .catch(() => undefined)
      }
    }
  }

  async removeMedia(soundscapeId: string, localPaths: string[]) {
    if (localPaths.length === 0) return
    const directory = await this.root()
      .then((root) => root.getDirectoryHandle(soundscapeId))
      .catch(() => undefined)
    if (!directory) return
    await Promise.all(
      localPaths.map((path) =>
        directory.removeEntry(path).catch(() => undefined)
      )
    )
  }

  async restore(id: string) {
    const stored = await transaction<StoredManifest | undefined>(
      'readonly',
      (store) => store.get(id)
    )
    if (!stored) return undefined
    const manifest = parseSoundscapeManifest(stored.manifest)
    const directory = await (await this.root()).getDirectoryHandle(id)
    const files = new Map<string, File>()
    for (const media of mediaFiles(manifest)) {
      const storedFile = await (
        await directory.getFileHandle(media.reference.localPath)
      ).getFile()
      files.set(
        media.reference.localPath,
        new File([storedFile], media.name, {
          type: media.mimeType,
          lastModified: storedFile.lastModified
        })
      )
    }
    return { manifest, files }
  }

  async restoreLast() {
    const id = localStorage.getItem(LAST_KEY)
    return id ? this.restore(id) : undefined
  }

  setLast(id: string) {
    localStorage.setItem(LAST_KEY, id)
  }

  async list() {
    const stored = await transaction<StoredManifest[]>('readonly', (store) =>
      store.getAll()
    )
    return stored.map(({ manifest }) => parseSoundscapeManifest(manifest))
  }

  async delete(id: string) {
    const root = await this.root()
    await root.removeEntry(id, { recursive: true }).catch(() => undefined)
    await transaction('readwrite', (store) => store.delete(id))
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
  }
}
