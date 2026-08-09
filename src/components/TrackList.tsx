import type { TrackViewModel } from '../features/tracks/useTracks'
import { VolumeControl } from './VolumeControl'

interface TrackListProps {
  tracks: TrackViewModel[]
  onToggle: (track: TrackViewModel) => void
  onRemove: (id: string) => void
  onVolume: (id: string, volume: number) => void
  onEffectChance: (id: string, chance: number) => void
}

export function TrackList({
  tracks,
  onToggle,
  onRemove,
  onVolume,
  onEffectChance
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden="true">♫</span>
        <h2>Your soundscape is empty</h2>
        <p>Choose one or more audio files to begin mixing.</p>
      </div>
    )
  }

  return (
    <section aria-labelledby="tracks-heading">
      <h2 id="tracks-heading" className="section-heading">
        Tracks
      </h2>
      <ul className="track-list">
        {tracks.map((track) => (
          <li className="track" key={track.id}>
            <div className="track-main">
              <button
                className="icon-button play-button"
                type="button"
                aria-label={`${track.isSoundEffect ? (track.isEnabled ? 'Disable' : 'Enable') : track.isPlaying ? 'Pause' : 'Play'} ${track.name}`}
                disabled={track.status !== 'ready'}
                onClick={() => void onToggle(track)}
              >
                {track.status === 'loading'
                  ? '…'
                  : track.isSoundEffect
                    ? track.isEnabled
                      ? 'Ⅱ'
                      : '▶'
                    : track.isPlaying
                      ? 'Ⅱ'
                      : '▶'}
              </button>
              <div className="track-info">
                <strong title={track.name}>{track.name}</strong>
                {track.isSoundEffect && (
                  <span>
                    Sound effect · random playback{' '}
                    {track.isEnabled ? 'enabled' : 'disabled'}
                  </span>
                )}
                {track.status === 'loading' && <span>Preparing audio…</span>}
                {track.error && (
                  <span className="error" role="alert">
                    {track.error}
                  </span>
                )}
              </div>
              <button
                className="remove-button"
                type="button"
                onClick={() => onRemove(track.id)}
                aria-label={`Remove ${track.name}`}
              >
                Remove
              </button>
            </div>
            <VolumeControl
              id={`volume-${track.id}`}
              label={`Volume for ${track.name}`}
              value={track.volume}
              onChange={(volume) => onVolume(track.id, volume)}
            />
            {track.isSoundEffect && (
              <label className="effect-chance" htmlFor={`chance-${track.id}`}>
                Play chance each second
                <span>
                  1 in{' '}
                  <input
                    id={`chance-${track.id}`}
                    type="number"
                    min="1"
                    step="1"
                    value={track.chance}
                    onChange={(event) =>
                      onEffectChance(
                        track.id,
                        event.currentTarget.valueAsNumber
                      )
                    }
                  />
                </span>
              </label>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
