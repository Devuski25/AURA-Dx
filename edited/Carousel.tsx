import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import { useReducedMotion } from "framer-motion"

export type CarouselItem = { key: string; label: string; node: ReactNode }

const FADE_EDGES = "linear-gradient(to right, transparent, #000 9%, #000 91%, transparent)"
const SMOOTH = "ease-[cubic-bezier(0.22,1,0.36,1)]"

/**
 * Centered snap carousel with optional autoplay.
 * - Native scroll-snap, so touch swipe and trackpads stay smooth.
 * - Mouse drag, arrows, dots and ArrowLeft / ArrowRight all work.
 * - autoPlay={ms}: advances on its own, loops back to the first slide, and pauses while the pointer is over it,
 *   focus is inside it, it is off screen, or the tab is hidden. A visible pause button lets people stop it for good.
 *   Never autoplays when reduced motion is on.
 */
export function Carousel({ label, items, autoPlay }: { label: string; items: CarouselItem[]; autoPlay?: number }) {
  const reduce = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLUListElement>(null)
  const slideRefs = useRef<(HTMLLIElement | null)[]>([])
  const activeRef = useRef(0)
  const frame = useRef(0)
  const drag = useRef({ on: false, startX: 0, startLeft: 0 })
  const [active, setActive] = useState(0)

  // autoplay state
  const [userPaused, setUserPaused] = useState(false)
  const [hovering, setHovering] = useState(false)
  const [focused, setFocused] = useState(false)
  const [onScreen, setOnScreen] = useState(false)
  const [tabVisible, setTabVisible] = useState(true)
  const [cycle, setCycle] = useState(0)
  const canAutoPlay = !!autoPlay && !reduce && items.length > 1
  const running = canAutoPlay && !userPaused && !hovering && !focused && onScreen && tabVisible

  const update = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const center = track.scrollLeft + track.clientWidth / 2
    let best = 0
    let bestDist = Infinity
    slideRefs.current.forEach((li, i) => {
      if (!li) return
      const dist = Math.abs(li.offsetLeft + li.offsetWidth / 2 - center)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
      if (!reduce) li.style.setProperty("--d", Math.min(1, dist / (li.offsetWidth * 1.1)).toFixed(3))
    })
    activeRef.current = best
    setActive(best)
  }, [reduce])

  const goTo = useCallback(
    (index: number) => {
      const track = trackRef.current
      const i = Math.max(0, Math.min(items.length - 1, index))
      const li = slideRefs.current[i]
      if (!track || !li) return
      track.scrollTo({ left: li.offsetLeft + li.offsetWidth / 2 - track.clientWidth / 2, behavior: reduce ? "auto" : "smooth" })
    },
    [items.length, reduce],
  )

  useEffect(() => {
    update()
    const track = trackRef.current
    if (!track) return
    const ro = new ResizeObserver(update)
    ro.observe(track)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(frame.current)
    }
  }, [update])

  // Only run while the carousel is actually on screen and the tab is in front
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), { threshold: 0.4 })
    io.observe(el)
    const onVis = () => setTabVisible(!document.hidden)
    document.addEventListener("visibilitychange", onVis)
    return () => {
      io.disconnect()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])

  // The autoplay clock. It restarts after every slide change, so manual navigation resets the countdown.
  useEffect(() => {
    if (!running || !autoPlay) return
    const id = window.setTimeout(() => goTo(active >= items.length - 1 ? 0 : active + 1), autoPlay)
    return () => window.clearTimeout(id)
  }, [running, active, autoPlay, items.length, goTo])

  // Restart the dot-fill animation each time autoplay (re)starts, so it matches the clock above
  useEffect(() => {
    if (running) setCycle((c) => c + 1)
  }, [running])

  const onScroll = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(update)
  }

  // Mouse drag (touch uses native scrolling)
  const onPointerDown = (e: PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current
    if (e.pointerType !== "mouse" || !track) return
    drag.current = { on: true, startX: e.clientX, startLeft: track.scrollLeft }
    track.style.scrollSnapType = "none"
    track.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current
    if (!drag.current.on || !track) return
    track.scrollLeft = drag.current.startLeft - (e.clientX - drag.current.startX)
  }
  const endDrag = (e: PointerEvent<HTMLUListElement>) => {
    const track = trackRef.current
    if (!drag.current.on || !track) return
    drag.current.on = false
    track.style.scrollSnapType = ""
    track.releasePointerCapture(e.pointerId)
    goTo(activeRef.current)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault()
      goTo(activeRef.current + 1)
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      goTo(activeRef.current - 1)
    }
  }

  const ctrl = `flex h-11 w-11 items-center justify-center rounded-full border border-aura-border text-aura-forest transition-all duration-500 ${SMOOTH} hover:bg-aura-forest hover:text-white active:scale-90 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aura-accent-dark focus-visible:ring-offset-2`

  return (
    <div
      ref={wrapRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovering(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
      }}
    >
      <div style={{ maskImage: FADE_EDGES, WebkitMaskImage: FADE_EDGES }}>
        <ul
          ref={trackRef}
          tabIndex={0}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDragStart={(e) => e.preventDefault()}
          className="relative m-0 flex cursor-grab touch-pan-x select-none snap-x snap-mandatory list-none gap-5 overflow-x-auto px-[calc(50%_-_var(--w)_/_2)] py-8 [--w:14rem] [scrollbar-width:none] active:cursor-grabbing focus-visible:outline-none md:[--w:16rem] lg:[--w:17rem] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item, i) => (
            <li
              key={item.key}
              ref={(el) => {
                slideRefs.current[i] = el
              }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${items.length}: ${item.label}`}
              className="w-[var(--w)] shrink-0 snap-center"
            >
              <div style={reduce ? undefined : { transform: "scale(calc(1 - var(--d, 0) * 0.14))", opacity: "calc(1 - var(--d, 0) * 0.5)", willChange: "transform, opacity" }}>
                {item.node}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4">
        <div className="flex items-center">
          {items.map((item, i) => (
            <button key={item.key} type="button" onClick={() => goTo(i)} aria-label={`Show ${item.label}`} aria-current={i === active} className="group p-2 focus-visible:outline-none">
              <span
                className={`block h-2 overflow-hidden rounded-full transition-all duration-500 ${SMOOTH} group-focus-visible:ring-2 group-focus-visible:ring-aura-accent-dark group-focus-visible:ring-offset-2 ${
                  i === active ? "w-8 bg-aura-forest/25" : "w-2 bg-aura-border group-hover:bg-aura-accent/60"
                }`}
              >
                {/* active dot: fills over the autoplay interval; solid when paused or not autoplaying */}
                {i === active && (
                  <span
                    key={`${active}-${cycle}`}
                    className="block h-full w-full origin-left rounded-full bg-aura-forest"
                    style={running ? { animation: `aura-dot-fill ${autoPlay}ms linear forwards` } : undefined}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {canAutoPlay && (
            <button type="button" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? "Start auto-play" : "Pause auto-play"} className={ctrl}>
              {userPaused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous" className={ctrl}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => goTo(active + 1)} disabled={active === items.length - 1} aria-label="Next" className={ctrl}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Announce slide changes only when the user is driving; stay quiet while it auto-advances */}
      <p className="sr-only" aria-live={running ? "off" : "polite"}>{`${items[active]?.label}, ${active + 1} of ${items.length}`}</p>
    </div>
  )
}
