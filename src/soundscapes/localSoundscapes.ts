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
    const request = run(database.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => database.close())
}

const mediaFiles = (manifest: SoundscapeManifest) => [
  ...(manifest.image ? [manifest.image] : []),
  ...manifest.tracks
]

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
    const root = await this.root()
    const directory = await root.getDirectoryHandle(manifest.id, {
      create: true
    })
    for (const media of mediaFiles(manifest)) {
      const file = files.get(media.reference.localPath)
      if (!file)
        throw new Error(`The media file “${media.name}” is unavailable.`)
      const handle = await directory.getFileHandle(media.reference.localPath, {
        create: true
      })
      const writable = await handle.createWritable()
      await file.stream().pipeTo(writable)
    }
    await transaction('readwrite', (store) =>
      store.put({ id: manifest.id, manifest } satisfies StoredManifest)
    )
    localStorage.setItem(LAST_KEY, manifest.id)
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
      const file = await (
        await directory.getFileHandle(media.reference.localPath)
      ).getFile()
      files.set(media.reference.localPath, file)
    }
    return { manifest, files }
  }

  async restoreLast() {
    const id = localStorage.getItem(LAST_KEY)
    return id ? this.restore(id) : undefined
  }

  async delete(id: string) {
    const root = await this.root()
    await root.removeEntry(id, { recursive: true }).catch(() => undefined)
    await transaction('readwrite', (store) => store.delete(id))
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
  }
}
