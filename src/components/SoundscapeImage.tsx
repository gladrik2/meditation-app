import { useEffect, useMemo, useRef, useState } from 'react'

interface SoundscapeImageProps {
  image: File | null
  onChoose: () => void
  onRemove: () => void
}

export function SoundscapeImage({
  image,
  onChoose,
  onRemove
}: SoundscapeImageProps) {
  const imageUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image]
  )
  const [isTheater, setIsTheater] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const fullscreenRequested = useRef(false)

  useEffect(() => {
    if (imageUrl) return () => URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  useEffect(() => {
    if (!isTheater) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) {
        setIsTheater(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isTheater])

  useEffect(() => {
    if (!isTheater || !fullscreenRequested.current) return
    fullscreenRequested.current = false
    const request = viewerRef.current?.requestFullscreen
    if (request) {
      void request.call(viewerRef.current).catch(() => {
        // Theater mode remains available when fullscreen is denied.
      })
    }
  }, [isTheater])

  const enterFullscreen = () => {
    fullscreenRequested.current = true
    setIsTheater(true)
  }

  const leaveViewer = async () => {
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen()
    }
    setIsTheater(false)
  }

  const removeImage = () => {
    setIsTheater(false)
    onRemove()
  }

  if (!image || !imageUrl) {
    return (
      <section className="image-panel" aria-labelledby="image-heading">
        <div>
          <h2 id="image-heading">Soundscape image</h2>
          <p>Add one image to set the visual mood for your soundscape.</p>
        </div>
        <button className="secondary-control" type="button" onClick={onChoose}>
          Add image
        </button>
      </section>
    )
  }

  return (
    <section
      className="image-panel image-panel-with-preview"
      aria-labelledby="image-heading"
    >
      <div className="image-copy">
        <h2 id="image-heading">Soundscape image</h2>
        <p title={image.name}>{image.name}</p>
      </div>
      <img className="image-thumbnail" src={imageUrl} alt="Soundscape visual" />
      <div className="image-actions">
        <button className="secondary-control" type="button" onClick={onChoose}>
          Replace
        </button>
        <button className="remove-button" type="button" onClick={removeImage}>
          Remove
        </button>
        <button
          className="primary-control"
          type="button"
          onClick={() => setIsTheater(true)}
        >
          Theater mode
        </button>
        <button
          className="primary-control"
          type="button"
          onClick={enterFullscreen}
        >
          Full screen
        </button>
      </div>

      {isTheater && (
        <div
          className="image-viewer"
          ref={viewerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Soundscape image viewer"
        >
          <img src={imageUrl} alt="Soundscape visual" />
          <button
            type="button"
            className="viewer-exit"
            onClick={() => void leaveViewer()}
          >
            Exit view
          </button>
        </div>
      )}
    </section>
  )
}
