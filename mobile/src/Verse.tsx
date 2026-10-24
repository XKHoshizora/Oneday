import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

// Writing time follows each character's stroke count, so the verse keeps a handwritten rhythm.
const strokes: Record<string, number> = {
  直: 8,
  到: 8,
  有: 6,
  一: 1,
  天: 4,
  愿: 14,
  你: 7,
  不: 4,
  再: 6,
  需: 14,
  要: 9,
  连: 7,
  接: 11,
  在: 6,
  那: 6,
  之: 3,
  前: 9,
  让: 5,
  简: 13,
  单: 8,
  点: 9,
}

// A word is written in one breath; a column ends when the brush is lifted and re-inked.
const columns = [
  { words: ['直到', '有一天'], pace: 'small' },
  { words: ['愿你', '不再'], pace: 'large' },
  { words: ['需要', '连接。'], pace: 'large' },
  { words: ['在那之前，', '让连接', '简单一点。'], pace: 'small' },
] as const

const paces = {
  small: { base: 60, perStroke: 9, gap: 24, word: 100 },
  large: { base: 120, perStroke: 17, gap: 40, word: 170 },
}
const columnPauses = [320, 380, 440]
const marks = '，。'

type Glyph = { char: string; delay: number; duration: number; mark: boolean }

function schedule(): Glyph[][] {
  let clock = 250
  return columns.map((column, index) => {
    const pace = paces[column.pace]
    const glyphs: Glyph[] = []
    let end = clock
    column.words.forEach((word, position) => {
      if (position > 0) clock += pace.word
      for (const char of word) {
        const mark = marks.includes(char)
        if (mark) clock += 70
        const duration = mark
          ? 260
          : pace.base + pace.perStroke * (strokes[char] ?? 6)
        glyphs.push({ char, delay: clock, duration, mark })
        end = Math.max(end, clock + duration)
        // The next character starts while this one's ink is still settling.
        clock += mark ? 260 : duration * 0.58 + pace.gap
      }
    })
    clock = end + (columnPauses[index] ?? 0)
    return glyphs
  })
}

const [lead, first, second, coda] = schedule()
const writtenKey = 'oneday.verse-written'

function finish(event: MouseEvent<HTMLDivElement>) {
  for (const animation of event.currentTarget.getAnimations({ subtree: true }))
    animation.finish()
}

// Screen readers get the whole line; per-character spans would be read one by one.
function Line({ glyphs }: { glyphs: Glyph[] }) {
  return (
    <>
      <span className="sr-only">
        {glyphs.map((glyph) => glyph.char).join('')}
      </span>
      <span aria-hidden="true">
        {glyphs.map((glyph) => (
          <span
            key={glyph.delay}
            className={glyph.mark ? 'mark' : 'glyph'}
            style={
              {
                '--d': `${glyph.delay}ms`,
                '--w': `${glyph.duration}ms`,
              } as CSSProperties
            }
          >
            {glyph.char}
          </span>
        ))}
      </span>
    </>
  )
}

export function Verse() {
  const verseRef = useRef<HTMLDivElement>(null)
  // The verse is written in full until one launch sees it through; later launches replay it quickly.
  const [quick] = useState(() => localStorage.getItem(writtenKey) !== null)
  useEffect(() => {
    if (quick || !verseRef.current) return
    const writing = verseRef.current.getAnimations({ subtree: true })
    void Promise.all(writing.map((animation) => animation.finished)).then(() =>
      localStorage.setItem(writtenKey, '1'),
    )
  }, [quick])
  return (
    <div
      ref={verseRef}
      className={quick ? 'verse quick' : 'verse'}
      onClick={finish}
    >
      <p className="eyebrow">
        <Line glyphs={lead} />
      </p>
      <h1>
        <span>
          <Line glyphs={first} />
        </span>
        <span>
          <Line glyphs={second} />
        </span>
      </h1>
      <p className="intro">
        <Line glyphs={coda} />
      </p>
    </div>
  )
}
