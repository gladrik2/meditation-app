import { useEffect, useState } from 'react'

type TimerMode = 'countdown' | 'stopwatch'
type TimerStatus = 'idle' | 'running' | 'paused' | 'complete'

interface MeditationTimerProps {
  onStart: (playAllAudio: boolean) => void | Promise<void>
  onComplete: () => void
}

const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function MeditationTimer({ onStart, onComplete }: MeditationTimerProps) {
  const [mode, setMode] = useState<TimerMode>('countdown')
  const [status, setStatus] = useState<TimerStatus>('idle')
  const [duration, setDuration] = useState(300)
  const [elapsed, setElapsed] = useState(0)
  const [playAllAudio, setPlayAllAudio] = useState(false)

  useEffect(() => {
    if (status !== 'running') return
    const interval = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 1
        if (mode === 'countdown' && next >= duration) {
          window.clearInterval(interval)
          setStatus('complete')
          onComplete()
          return duration
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [duration, mode, onComplete, status])

  const clearCompletion = () => {
    if (status === 'complete') setStatus('idle')
  }
  const reset = () => {
    setElapsed(0)
    setStatus('idle')
  }
  const changeMode = (nextMode: TimerMode) => {
    setMode(nextMode)
    setElapsed(0)
    setStatus('idle')
  }
  const displayed =
    mode === 'countdown' ? Math.max(0, duration - elapsed) : elapsed

  return (
    <section
      className={`timer-panel${status === 'complete' ? ' timer-panel-complete' : ''}`}
      aria-labelledby="timer-title"
    >
      <div className="timer-heading">
        <h2 id="timer-title">Meditation timer</h2>
        <div className="timer-modes" aria-label="Timer mode">
          <button
            type="button"
            aria-pressed={mode === 'countdown'}
            onClick={() => changeMode('countdown')}
          >
            Countdown
          </button>
          <button
            type="button"
            aria-pressed={mode === 'stopwatch'}
            onClick={() => changeMode('stopwatch')}
          >
            Stopwatch
          </button>
        </div>
      </div>
      {mode === 'countdown' && (
        <label className="timer-duration">
          Countdown duration (minutes)
          <input
            type="number"
            min="1"
            max="180"
            value={Math.ceil(duration / 60)}
            onChange={(event) => {
              const minutes = Math.max(
                1,
                Number(event.currentTarget.value) || 1
              )
              setDuration(minutes * 60)
              setElapsed(0)
              setStatus('idle')
            }}
          />
        </label>
      )}
      <output className="timer-display" aria-label="Timer">
        {formatTime(displayed)}
      </output>
      <p className="timer-completion" role="status" aria-live="polite">
        {status === 'complete' ? 'Meditation complete' : ''}
      </p>
      <label className="timer-play-audio">
        <input
          type="checkbox"
          checked={playAllAudio}
          onChange={(event) => setPlayAllAudio(event.currentTarget.checked)}
        />
        Play all audio when meditation starts
      </label>
      <div className="timer-controls">
        {status === 'running' ? (
          <button type="button" onClick={() => setStatus('paused')}>
            Pause
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              clearCompletion()
              if (status === 'complete') setElapsed(0)
              setStatus('running')
              void onStart(playAllAudio)
            }}
          >
            Start
          </button>
        )}
        <button type="button" onClick={reset}>
          Reset
        </button>
      </div>
    </section>
  )
}
