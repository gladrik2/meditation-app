interface VolumeControlProps {
  id: string
  label: string
  value: number
  onChange: (value: number) => void
}

export function VolumeControl({
  id,
  label,
  value,
  onChange
}: VolumeControlProps) {
  return (
    <div className="volume-control">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <output htmlFor={id}>{Math.round(value * 100)}%</output>
    </div>
  )
}
