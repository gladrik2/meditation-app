import {
  forwardRef,
  useCallback,
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
  showCompletionBlackout: () => void
}

type Point = { x: number; y: number }
type View = Point & { scale: number }
const FIT_VIEW: View = { x: 0, y: 0, scale: 1 }

export const SoundscapeImage = forwardRef<
  SoundscapeImageHandle,
  SoundscapeImageProps
>(function SoundscapeImage({ image, onChoose, onRemove }, ref) {
  const imageUrl = useMemo(
    () => (image ? URL.createObjectURL(image) : null),
    [image]
  )
  const [isTheater, setIsTheater] = useState(false)
  const [showBlackout, setShowBlackout] = useState(false)
  const [view, setView] = useState<View>(FIT_VIEW)
  const [fit, setFit] = useState({ width: 0, height: 0 })
  const viewerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const enteredFullscreen = useRef(false)
  const historyEntry = useRef(false)
  const restoreFocus = useRef<HTMLElement | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const lastTap = useRef<(Point & { time: number }) | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view

  const clampView = useCallback(
    (candidate: View): View => {
      const viewer = viewerRef.current
      if (!viewer) return candidate
      const scale = Math.min(4, Math.max(1, candidate.scale))
      const maxX = Math.max(0, (fit.width * scale - viewer.clientWidth) / 2)
      const maxY = Math.max(0, (fit.height * scale - viewer.clientHeight) / 2)
      return {
        scale,
        x: maxX ? Math.min(maxX, Math.max(-maxX, candidate.x)) : 0,
        y: maxY ? Math.min(maxY, Math.max(-maxY, candidate.y)) : 0
      }
    },
    [fit]
  )

  const updateView = useCallback(
    (next: View) => {
      const clamped = clampView(next)
      viewRef.current = clamped
      setView(clamped)
    },
    [clampView]
  )

  const resetView = useCallback(() => {
    pointers.current.clear()
    viewRef.current = FIT_VIEW
    setView(FIT_VIEW)
  }, [])

  const measure = useCallback(() => {
    const viewer = viewerRef.current
    const displayedImage = imageRef.current
    if (
      !viewer ||
      !displayedImage?.naturalWidth ||
      !displayedImage.naturalHeight
    )
      return
    const ratio = Math.min(
      viewer.clientWidth / displayedImage.naturalWidth,
      viewer.clientHeight / displayedImage.naturalHeight
    )
    setFit({
      width: displayedImage.naturalWidth * ratio,
      height: displayedImage.naturalHeight * ratio
    })
  }, [])

  useEffect(() => {
    if (imageUrl) return () => URL.revokeObjectURL(imageUrl)
  }, [imageUrl])

  useEffect(() => resetView(), [imageUrl, resetView])

  useEffect(() => {
    if (!isTheater) return
    restoreFocus.current = document.activeElement as HTMLElement | null
    viewerRef.current?.focus()
    measure()
    const resize = () => measure()
    window.addEventListener('resize', resize)
    window.addEventListener('orientationchange', resize)
    document.addEventListener('fullscreenchange', resize)
    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('orientationchange', resize)
      document.removeEventListener('fullscreenchange', resize)
      restoreFocus.current?.focus()
    }
  }, [isTheater, measure])

  useEffect(() => {
    updateView(viewRef.current)
  }, [fit, updateView])

  const closeViewer = useCallback(
    async (consumeHistory = true) => {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen()
      }
      setIsTheater(false)
      setShowBlackout(false)
      resetView()
      if (consumeHistory && historyEntry.current) history.back()
      historyEntry.current = false
    },
    [resetView]
  )

  useEffect(() => {
    if (!isTheater) return
    const onPopState = () => {
      if (!historyEntry.current) return
      historyEntry.current = false
      void closeViewer(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const editing =
        target?.matches('input, textarea, select') || target?.isContentEditable
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeViewer()
      } else if (
        !editing &&
        !showBlackout &&
        ['+', '=', '-', '0'].includes(event.key)
      ) {
        event.preventDefault()
        if (event.key === '0') resetView()
        else {
          const factor = event.key === '-' ? 1 / 1.25 : 1.25
          const current = viewRef.current
          updateView({ ...current, scale: current.scale * factor })
        }
      }
    }
    const onFullscreenChange = () => {
      if (enteredFullscreen.current && !document.fullscreenElement) {
        enteredFullscreen.current = false
        void closeViewer()
      }
    }
    window.addEventListener('popstate', onPopState)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      window.removeEventListener('popstate', onPopState)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [closeViewer, isTheater, resetView, showBlackout, updateView])

  const openTheater = () => {
    resetView()
    history.pushState({ imageTheater: true }, '')
    historyEntry.current = true
    setIsTheater(true)
  }

  const enterFullscreen = async () => {
    resetView()
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
    },
    showCompletionBlackout: () => {
      if (isTheater) {
        resetView()
        setShowBlackout(true)
      }
    }
  }))

  const zoomAt = (scale: number, client: Point) => {
    const rect = viewerRef.current?.getBoundingClientRect()
    if (!rect) return
    const current = viewRef.current
    const nextScale = Math.min(4, Math.max(1, scale))
    const focal = {
      x: client.x - (rect.left + rect.width / 2),
      y: client.y - (rect.top + rect.height / 2)
    }
    const ratio = nextScale / current.scale
    updateView({
      scale: nextScale,
      x: focal.x - (focal.x - current.x) * ratio,
      y: focal.y - (focal.y - current.y) * ratio
    })
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (showBlackout) return
    if (event.currentTarget.setPointerCapture)
      event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const previous = pointers.current.get(event.pointerId)
    if (!previous || showBlackout) return
    const allBefore = [...pointers.current.values()]
    const next = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, next)
    if (pointers.current.size === 1 && viewRef.current.scale > 1) {
      const current = viewRef.current
      updateView({
        ...current,
        x: current.x + next.x - previous.x,
        y: current.y + next.y - previous.y
      })
    } else if (pointers.current.size === 2 && allBefore.length === 2) {
      const [a, b] = allBefore
      const after = [...pointers.current.values()]
      const [c, d] = after
      const oldDistance = Math.hypot(a.x - b.x, a.y - b.y)
      const newDistance = Math.hypot(c.x - d.x, c.y - d.y)
      const oldMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const newMid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 }
      zoomAt(viewRef.current.scale * (newDistance / oldDistance), oldMid)
      const current = viewRef.current
      updateView({
        ...current,
        x: current.x + newMid.x - oldMid.x,
        y: current.y + newMid.y - oldMid.y
      })
    }
  }

  const removePointer = (event: React.PointerEvent) => {
    const wasOnlyPointer = pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    if (
      showBlackout ||
      event.type !== 'pointerup' ||
      event.pointerType !== 'touch' ||
      !wasOnlyPointer
    )
      return
    const tap = { x: event.clientX, y: event.clientY, time: event.timeStamp }
    const previous = lastTap.current
    if (
      previous &&
      tap.time - previous.time < 350 &&
      Math.hypot(tap.x - previous.x, tap.y - previous.y) < 30
    ) {
      zoomAt(viewRef.current.scale === 1 ? 2 : 1, tap)
      lastTap.current = null
    } else lastTap.current = tap
  }

  const removeImage = () => {
    void closeViewer()
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
        <button className="primary-control" type="button" onClick={openTheater}>
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
          className={`image-viewer${showBlackout ? ' image-viewer-complete' : ''}`}
          ref={viewerRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          aria-label={
            showBlackout
              ? 'Meditation completed. Tap or press Escape to exit.'
              : 'Soundscape image viewer. Pinch or use the mouse wheel to zoom, drag to pan, use plus, minus, or zero to adjust zoom, and press Escape or browser Back to exit.'
          }
          onClick={showBlackout ? () => void closeViewer() : undefined}
          onDoubleClick={
            showBlackout
              ? undefined
              : (event) =>
                  zoomAt(viewRef.current.scale === 1 ? 2 : 1, {
                    x: event.clientX,
                    y: event.clientY
                  })
          }
          onWheel={
            showBlackout
              ? undefined
              : (event) => {
                  event.preventDefault()
                  zoomAt(
                    viewRef.current.scale * Math.exp(-event.deltaY * 0.002),
                    { x: event.clientX, y: event.clientY }
                  )
                }
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={removePointer}
          onPointerCancel={removePointer}
        >
          {!showBlackout && (
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Soundscape visual"
              draggable={false}
              onLoad={measure}
              style={{
                width: fit.width,
                height: fit.height,
                transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`
              }}
            />
          )}
          {showBlackout && (
            <p className="image-viewer-complete-message">meditation complete</p>
          )}
        </div>
      )}
    </section>
  )
})
