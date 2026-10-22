/* The touch-layout marker.

   A phone and a tablet are touched, not hovered, and on a touch screen a
   tap latches the `:hover` state — the control keeps its hover colour
   after the finger has moved on, which reads as a button stuck half
   pressed.

   So below the desktop breakpoint the app marks the document with
   `data-tap`, and the `hover-tap:` variant in index.css turns the colour
   a control takes on hover into the colour it simply has. The desktop
   keeps the hover.

   Two things put a device here, and either one is enough.

   The first is the capability: a screen with no pointer that can hover.
   That is what a tablet actually is, and it stays true in landscape, where
   an iPad-class device is 1024px wide and therefore past the layout
   breakpoint -- it was being treated as a desktop, so its hover styles
   latched after every tap.

   The second is the width, and it is the app's own breakpoint rather than
   the device's: 1024px is where the persistent sidebar gives way to the
   drawer, so it is the same line the layout is drawn on. A narrow window
   on a desktop gets the touch colours too -- that is deliberate, because
   the layout is already the touch layout there.

   `matchMedia` fires the change listener itself, so a window dragged
   across the breakpoint flips the marker as it goes, and plugging a mouse
   into a tablet flips it the other way. */
const TOUCH_LAYOUT = "(hover: none), (max-width: 1023px)"

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
