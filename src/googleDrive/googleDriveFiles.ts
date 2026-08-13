export interface GoogleDriveDocument {
  id: string
  name: string
  mimeType: string
}

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

export function isSupportedDriveDocument(document: GoogleDriveDocument) {
  return (
    document.mimeType.startsWith('audio/') ||
    document.mimeType.startsWith('image/')
  )
}

export async function downloadGoogleDriveFiles(
  documents: GoogleDriveDocument[],
  accessToken: string,
  fetcher: typeof fetch = fetch
): Promise<File[]> {
  const unsupported = documents.filter(
    (document) => !isSupportedDriveDocument(document)
  )
  if (unsupported.length > 0) {
    throw new Error(
      'Google Drive can only add audio and image files. Remove unsupported files and try again.'
    )
  }

  return Promise.all(
    documents.map(async (document) => {
      const response = await fetcher(
        `${DRIVE_FILES_URL}/${encodeURIComponent(document.id)}?alt=media`,
        {
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      )

      if (!response.ok) {
        throw new Error(
          `Could not download “${document.name}” from Google Drive (${response.status}).`
        )
      }

      const contents = await response.blob()
      return new File([contents], document.name, {
        type: document.mimeType || contents.type,
        lastModified: Date.now()
      })
    })
  )
}
