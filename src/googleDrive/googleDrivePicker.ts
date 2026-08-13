const GOOGLE_API_SCRIPT_URL = 'https://apis.google.com/js/api.js'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

interface PickerDocument {
  id?: string
  name?: string
  mimeType?: string
}

interface PickerData {
  action?: string
  docs?: PickerDocument[]
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder
  enableFeature(feature: string): PickerBuilder
  setAppId(appId: string): PickerBuilder
  setCallback(callback: (data: PickerData) => void): PickerBuilder
  setDeveloperKey(apiKey: string): PickerBuilder
  setOAuthToken(accessToken: string): PickerBuilder
  build(): { setVisible(visible: boolean): void }
}

export interface GooglePickerApi {
  Action: { CANCEL: string; PICKED: string }
  DocsView: new (viewId: string) => {
    setIncludeFolders(include: boolean): unknown
    setSelectFolderEnabled(enabled: boolean): unknown
  }
  Feature: { MULTISELECT_ENABLED: string }
  PickerBuilder: new () => PickerBuilder
  ViewId: { DOCS: string }
}

interface GoogleApiLoader {
  load(name: string, options: { callback(): void; onerror(): void }): void
}

declare global {
  interface Window {
    gapi?: GoogleApiLoader
  }
}

const getPickerApi = () =>
  (
    window.google as
      (typeof window.google & { picker?: GooglePickerApi }) | undefined
  )?.picker

let pickerScriptPromise: Promise<GooglePickerApi> | undefined

export function loadGooglePicker(): Promise<GooglePickerApi> {
  const loadedPicker = getPickerApi()
  if (loadedPicker) return Promise.resolve(loadedPicker)
  if (pickerScriptPromise) return pickerScriptPromise

  pickerScriptPromise = new Promise((resolve, reject) => {
    const fail = () => {
      pickerScriptPromise = undefined
      reject(
        new Error('Google Drive Picker could not be loaded. Please try again.')
      )
    }
    const loadPicker = () => {
      if (!window.gapi) {
        fail()
        return
      }
      window.gapi.load('picker', {
        callback: () => {
          const picker = getPickerApi()
          if (picker) resolve(picker)
          else fail()
        },
        onerror: fail
      })
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_API_SCRIPT_URL}"]`
    )
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', loadPicker, { once: true })
    script.addEventListener('error', fail, { once: true })
    if (!existing) {
      script.src = GOOGLE_API_SCRIPT_URL
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  })

  return pickerScriptPromise
}

export interface GoogleDrivePicker {
  pickFiles(accessToken: string): Promise<File[] | undefined>
}

export class BrowserGoogleDrivePicker implements GoogleDrivePicker {
  constructor(
    private readonly apiKey: string,
    private readonly appId?: string,
    private readonly fetchFile: typeof fetch = fetch
  ) {}

  async pickFiles(accessToken: string) {
    const pickerApi = await loadGooglePicker()
    const documents = await new Promise<PickerDocument[] | undefined>(
      (resolve, reject) => {
        try {
          const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
          view.setIncludeFolders(false)
          view.setSelectFolderEnabled(false)

          const builder = new pickerApi.PickerBuilder()
            .addView(view)
            .enableFeature(pickerApi.Feature.MULTISELECT_ENABLED)
            .setDeveloperKey(this.apiKey)
            .setOAuthToken(accessToken)
            .setCallback((data) => {
              if (data.action === pickerApi.Action.CANCEL) resolve(undefined)
              if (data.action === pickerApi.Action.PICKED)
                resolve(data.docs ?? [])
            })
          if (this.appId) builder.setAppId(this.appId)
          builder.build().setVisible(true)
        } catch (error) {
          reject(error)
        }
      }
    )

    if (!documents) return undefined
    return Promise.all(
      documents.map((document) => this.downloadFile(document, accessToken))
    )
  }

  private async downloadFile(document: PickerDocument, accessToken: string) {
    if (!document.id)
      throw new Error('Google Drive returned a file without an ID.')
    const name = document.name || 'Google Drive file'
    const response = await this.fetchFile(
      `${DRIVE_FILES_URL}/${encodeURIComponent(document.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!response.ok) {
      throw new Error(
        `Could not download “${name}” from Google Drive (${response.status}).`
      )
    }
    const blob = await response.blob()
    const type = document.mimeType || blob.type
    return new File([blob], name, { type })
  }
}
