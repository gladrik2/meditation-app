import { useEffect, useRef, useState } from 'react'
import type { MeditationTimerSettings } from '../soundscapes/manifest'

interface MeditationTimerProps {
  settings: MeditationTimerSettings
  onSettingsChange: (settings: MeditationTimerSettings) => void
  onStart: () => void | Promise<void>
  onStartWithMedia: () => void | Promise<void>
  onComplete: () => void
}

const formatTime = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, '0'))
  return hours > 0 ? `${hours}:${parts.join(':')}` : parts.join(':')
}

export function MeditationTimer({
  settings,
  onSettingsChange,
  onStart,
  onStartWithMedia,
  onComplete
}: MeditationTimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [minutesDraft, setMinutesDraft] = useState(String(settings.minutes))
  const onCompleteRef = useRef(onComplete)
  const startedAt = useRef(0)
  const elapsedAtStart = useRef(0)

  const { mode, minutes, startMedia } = settings
  const durationSeconds = minutes * 60
  const displayedSeconds =
    mode === 'countdown'
      ? Math.max(0, durationSeconds - elapsedSeconds)
      : elapsedSeconds

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  useEffect(() => {
    if (!isRunning) return

    const update = () => {
      const nextElapsed =
        elapsedAtStart.current +
        Math.floor((Date.now() - startedAt.current) / 1000)

      if (mode === 'countdown' && nextElapsed >= durationSeconds) {
        setElapsedSeconds(durationSeconds)
        setIsRunning(false)
        setIsComplete(true)
        onCompleteRef.current()
        return
      }
      setElapsedSeconds(nextElapsed)
    }

    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [durationSeconds, isRunning, mode])

  const start = () => {
    setIsComplete(false)
    if (mode === 'countdown' && displayedSeconds === 0) setElapsedSeconds(0)
    elapsedAtStart.current =
      mode === 'countdown' && displayedSeconds === 0 ? 0 : elapsedSeconds
    startedAt.current = Date.now()
    setIsRunning(true)
    if (mode === 'countdown') void onStart()
    if (startMedia) void onStartWithMedia()
  }

  const pause = () => {
    setIsRunning(false)
  }

  const reset = () => {
    setIsRunning(false)
    setElapsedSeconds(0)
    setIsComplete(false)
  }

  const changeMode = (nextMode: MeditationTimerSettings['mode']) => {
    onSettingsChange({ ...settings, mode: nextMode })
    setIsRunning(false)
    setElapsedSeconds(0)
    setIsComplete(false)
  }

  const normalizeMinutesDraft = () => {
    setMinutesDraft(String(minutes))
  }

  return (
    <section className="meditation-timer" aria-labelledby="timer-heading">
      <div className="timer-settings">
        <div>
          <h2 id="timer-heading">Meditation timer</h2>
          <label htmlFor="timer-mode">Timer type</label>
          <select
            id="timer-mode"
            value={mode}
            disabled={isRunning}
            onChange={(event) =>
              changeMode(event.target.value as MeditationTimerSettings['mode'])
            }
          >
            <option value="stopwatch">Count up</option>
            <option value="countdown">Count down</option>
          </select>
        </div>
        {mode === 'countdown' && (
          <label className="duration-field" htmlFor="timer-minutes">
            Minutes
            <input
              id="timer-minutes"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={minutesDraft}
              disabled={isRunning}
              onChange={(event) => {
                const draft = event.target.value
                setMinutesDraft(draft)
                if (!/^[1-9]\d*$/.test(draft)) return

                const value = Number.parseInt(draft, 10)
                onSettingsChange({
                  ...settings,
                  minutes: value
                })
                setIsRunning(false)
                setElapsedSeconds(0)
                setIsComplete(false)
              }}
              onBlur={normalizeMinutesDraft}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
          </label>
        )}
      </div>

      <output className="timer-display" aria-live="off">
        {formatTime(displayedSeconds)}
      </output>
      {isComplete && (
        <p className="timer-complete" role="status">
          Meditation completed
        </p>
      )}
      <label className="timer-media-option">
        <input
          type="checkbox"
          checked={startMedia}
          onChange={(event) =>
            onSettingsChange({ ...settings, startMedia: event.target.checked })
          }
        />
        Play all audio and full screen the image when meditation starts
      </label>
      <div className="timer-buttons">
        <button
          type="button"
          className="primary-control"
          disabled={isRunning}
          onClick={start}
        >
          ▶ Start Meditation
        </button>
        <button
          type="button"
          className="secondary-control"
          disabled={!isRunning}
          onClick={pause}
        >
          Ⅱ Pause
        </button>
        <button
          type="button"
          className="secondary-control"
          disabled={elapsedSeconds === 0 && !isRunning}
          onClick={reset}
        >
          ↺ Reset
        </button>
      </div>
    </section>
  )
}
