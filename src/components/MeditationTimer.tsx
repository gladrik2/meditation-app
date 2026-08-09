import { useEffect, useRef, useState } from 'react'

type TimerMode = 'stopwatch' | 'countdown'

interface MeditationTimerProps {
  disabled: boolean
  onStart: () => void | Promise<void>
  onPause: () => void
}

const formatTime = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, '0'))
  return hours > 0 ? `${hours}:${parts.join(':')}` : parts.join(':')
}

export function MeditationTimer({
  disabled,
  onStart,
  onPause
}: MeditationTimerProps) {
  const [mode, setMode] = useState<TimerMode>('stopwatch')
  const [minutes, setMinutes] = useState(10)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const startedAt = useRef(0)
  const elapsedAtStart = useRef(0)

  const durationSeconds = minutes * 60
  const displayedSeconds =
    mode === 'countdown'
      ? Math.max(0, durationSeconds - elapsedSeconds)
      : elapsedSeconds

  useEffect(() => {
    if (!isRunning) return

    const update = () => {
      const nextElapsed =
        elapsedAtStart.current +
        Math.floor((Date.now() - startedAt.current) / 1000)

      if (mode === 'countdown' && nextElapsed >= durationSeconds) {
        setElapsedSeconds(durationSeconds)
        setIsRunning(false)
        onPause()
        return
      }
      setElapsedSeconds(nextElapsed)
    }

    const interval = window.setInterval(update, 250)
    return () => window.clearInterval(interval)
  }, [durationSeconds, isRunning, mode, onPause])

  const start = () => {
    if (mode === 'countdown' && displayedSeconds === 0) setElapsedSeconds(0)
    elapsedAtStart.current =
      mode === 'countdown' && displayedSeconds === 0 ? 0 : elapsedSeconds
    startedAt.current = Date.now()
    setIsRunning(true)
    void onStart()
  }

  const pause = () => {
    setIsRunning(false)
    onPause()
  }

  const reset = () => {
    setIsRunning(false)
    setElapsedSeconds(0)
    onPause()
  }

  const changeMode = (nextMode: TimerMode) => {
    setMode(nextMode)
    setIsRunning(false)
    setElapsedSeconds(0)
    onPause()
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
            onChange={(event) => changeMode(event.target.value as TimerMode)}
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
              min="1"
              step="1"
              value={minutes}
              disabled={isRunning}
              onChange={(event) => {
                const value = Number.parseInt(event.target.value, 10)
                setMinutes(Math.max(1, value || 1))
                setElapsedSeconds(0)
              }}
            />
          </label>
        )}
      </div>

      <output className="timer-display" aria-live="off">
        {formatTime(displayedSeconds)}
      </output>
      <div className="timer-buttons">
        <button
          type="button"
          className="primary-control"
          disabled={disabled || isRunning}
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
