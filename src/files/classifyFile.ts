const AUDIO_EXTENSIONS = new Set([
  'opus',
  'ogg',
  'oga',
  'webm',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'flac'
])

const AMBIGUOUS_AUDIO_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'application/ogg',
  'application/x-ogg'
])

export type MediaFileKind = 'image' | 'audio-candidate' | 'unsupported'

/**
 * Classifies file metadata without trusting that providers supplied an accurate
 * MIME type. Ambiguous files go through the audio backend, which performs the
 * authoritative decode check.
 */
export function classifyMediaFile(name: string, type: string): MediaFileKind {
  const mimeType = type.toLowerCase().split(';', 1)[0].trim()
  if (mimeType.startsWith('image/')) return 'image'

  if (mimeType.startsWith('audio/') || AMBIGUOUS_AUDIO_MIME_TYPES.has(mimeType))
    return 'audio-candidate'

  const extension = name.toLowerCase().match(/\.([^.]+)$/)?.[1]
  return extension !== undefined && AUDIO_EXTENSIONS.has(extension)
    ? 'audio-candidate'
    : 'unsupported'
}
