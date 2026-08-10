import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import { flushSync } from 'react-dom'

interface SoundscapeImageProps {
  image: File | null
  onChoose: () => void
  onRemove: () => void
}

export interface SoundscapeImageHandle {
  enterFullscreen: () => void
}

export const SoundscapeImage = forwardRef<
  SoundscapeImageHandle,
  SoundscapeImageProps
>(function SoundscapeImage({ image, onChoose, onRemove }, ref) {
  const imageUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image]
  )
  const [isTheater, setIsTheater] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)
  const enteredFullscreen = useRef(false)

  useEffect(() => {
    if (imageUrl) return () => URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  useEffect(() => {
    if (!isTheater) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsTheater(false)
    }
    const onFullscreenChange = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false
        setIsTheater(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [isTheater])

  const enterFullscreen = async () => {
    // Keep the fullscreen request in the click gesture while ensuring the
    // viewer is rendered before asking the browser to display it.
    flushSync(() => setIsTheater(true))
    const request = viewerRef.current?.requestFullscreen
    if (!request) return
    try {
      await request.call(viewerRef.current)
      enteredFullscreen.current = true
    } catch {
      // Theater mode remains available when fullscreen is denied.
    }
  }

  useImperativeHandle(ref, () => ({
    enterFullscreen: () => {
      if (imageUrl) void enterFullscreen()
    }
  }))

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
          onClick={() => void enterFullscreen()}
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
          aria-label="Soundscape image viewer. Click the image or press Escape to exit."
        >
          <img
            src={imageUrl}
            alt="Soundscape visual"
            onClick={() => void leaveViewer()}
          />
        </div>
      )}
    </section>
  )
})
