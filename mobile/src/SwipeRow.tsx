import {
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from 'react'

type SwipeRowProps = {
  label: string
  // A locked row still opens, but deleting reports why instead of collapsing the row.
  locked: boolean
  onDelete: () => void
  children: ReactNode
}

export function SwipeRow({ label, locked, onDelete, children }: SwipeRowProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ x: number; y: number; base: number } | null>(null)
  const draggedRef = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Rows open just wide enough for their own delete button.
  const reveal = () => (deleteRef.current?.offsetWidth ?? 68) + 8

  function down(event: PointerEvent<HTMLDivElement>) {
    dragRef.current = { x: event.clientX, y: event.clientY, base: offset }
    draggedRef.current = false
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    if (!draggedRef.current) {
      if (Math.abs(dx) < 6) return
      // A mostly vertical drag is the page scrolling, not a swipe.
      if (Math.abs(event.clientY - drag.y) > Math.abs(dx)) {
        dragRef.current = null
        return
      }
      draggedRef.current = true
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setOffset(Math.min(0, Math.max(-reveal() - 24, drag.base + dx)))
  }

  function up() {
    if (draggedRef.current)
      setOffset((value) => (value < -reveal() / 2 ? -reveal() : 0))
    dragRef.current = null
    setDragging(false)
  }

  // A drag, or a tap that only closes an open row, must not select what is underneath.
  function guard(event: MouseEvent<HTMLDivElement>) {
    if (!draggedRef.current && offset === 0) return
    event.preventDefault()
    event.stopPropagation()
    if (!draggedRef.current) setOffset(0)
    draggedRef.current = false
  }

  function remove() {
    const row = rowRef.current
    setOffset(0)
    if (locked || !row) return onDelete()
    row
      .animate(
        [
          { height: `${row.offsetHeight}px`, opacity: 1 },
          { height: '0px', opacity: 0 },
        ],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      )
      .finished.then(onDelete, onDelete)
  }

  return (
    <div ref={rowRef} className={offset < -24 ? 'swipe-row open' : 'swipe-row'}>
      <button
        ref={deleteRef}
        className="swipe-delete"
        tabIndex={offset ? 0 : -1}
        onClick={remove}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
        {label}
      </button>
      <div
        className="swipe-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : undefined,
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={guard}
      >
        {children}
      </div>
    </div>
  )
}
