import { useEffect, useRef } from 'react'

type PowerProps = {
  connected: boolean
  pending: boolean
  disabled: boolean
  rate: number
  label: string
  onToggle: () => void
}

const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Throughput maps onto ripples on a log scale: background chatter barely stirs the water,
// around 10 MB/s is full tide.
function tide(rate: number) {
  return Math.min(1, Math.log10(1 + rate / 1024) / 4)
}

function ring(
  zone: HTMLElement,
  className: string,
  keyframes: Keyframe[],
  duration: number,
) {
  const element = document.createElement('span')
  element.className = className
  zone.prepend(element)
  element
    .animate(keyframes, { duration, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)' })
    .finished.then(
      () => element.remove(),
      () => element.remove(),
    )
}

export function Power({
  connected,
  pending,
  disabled,
  rate,
  label,
  onToggle,
}: PowerProps) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const rateRef = useRef(rate)
  const wasPendingRef = useRef(pending)

  useEffect(() => {
    rateRef.current = rate
  }, [rate])

  // The sunrise ring only marks a connection the user just made, not one found on launch.
  useEffect(() => {
    if (connected && wasPendingRef.current && zoneRef.current && !calm())
      ring(
        zoneRef.current,
        'sunrise',
        [
          { transform: 'scale(0.92)', opacity: 1, borderWidth: '3px' },
          { transform: 'scale(2.1)', opacity: 0, borderWidth: '1px' },
        ],
        900,
      )
    wasPendingRef.current = pending
  }, [connected, pending])

  useEffect(() => {
    if (!connected || calm()) return
    let timer = 0
    const emit = () => {
      const level = tide(rateRef.current)
      if (zoneRef.current)
        ring(
          zoneRef.current,
          'ripple',
          [
            { transform: 'scale(1)', opacity: 0.16 + 0.34 * level },
            { transform: 'scale(1.95)', opacity: 0 },
          ],
          2600 - 1000 * level,
        )
      timer = window.setTimeout(emit, 2600 - 1900 * level)
    }
    timer = window.setTimeout(emit, 700)
    return () => window.clearTimeout(timer)
  }, [connected])

  const state = connected ? 'on' : pending ? 'pending' : disabled ? '' : 'idle'
  return (
    <div ref={zoneRef} className={`power-zone ${state}`}>
      <button
        className={`power ${connected ? 'active' : ''} ${pending ? 'pending' : ''}`}
        onClick={onToggle}
        disabled={disabled}
        aria-label={label}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 6v17M13 12a17 17 0 1 0 22 0" />
        </svg>
      </button>
    </div>
  )
}
