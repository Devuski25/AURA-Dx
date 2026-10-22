/* The touch-layout marker.

   A phone and a tablet are touched, not hovered, and on a touch screen a
   tap latches the `:hover` state — the control keeps its hover colour
   after the finger has moved on, which reads as a button stuck half
   pressed.

   So below the desktop breakpoint the app marks the document with
   `data-tap`, and the `hover-tap:` variant in index.css turns the colour
   a control takes on hover into the colour it simply has. The desktop
   keeps the hover.

   The breakpoint is the app's own, not the device's: 1024px is where the
   persistent sidebar gives way to the drawer, so it is the same line the
   layout is drawn on. A tablet in landscape is treated as a tablet for
   layout reasons, and it is treated as one here too.

   `matchMedia` fires the change listener itself, so a window dragged
   across the breakpoint flips the marker as it goes. */
const TOUCH_LAYOUT = "(max-width: 1023px)"

export function markTouchLayout(): void {
  if (typeof window === "undefined") return

  const root = document.documentElement
  const query = window.matchMedia(TOUCH_LAYOUT)

  const apply = () => {
    if (query.matches) root.setAttribute("data-tap", "")
    else root.removeAttribute("data-tap")
  }

  apply()
  query.addEventListener("change", apply)
}
