/** One easing family for the whole site so every transition feels related. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1] // fast start, long soft landing
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1]

/** Shared whileInView settings: fire once, slightly before the element is fully on screen. */
export const VIEWPORT = { once: true, amount: 0.2, margin: "0px 0px -6% 0px" } as const
