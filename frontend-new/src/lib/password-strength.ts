export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4

/**
 * Five independent checks, collapsed to a 0–4 level.
 *
 * A password can satisfy all five (8+ chars, upper, lower, digit, special),
 * but the meter divides by 4, so the score is clamped rather than allowed to
 * report 5. The clamp changes no observable output: the bar was already capped
 * at 100% by `overflow-hidden`, and the label chain always fell through to
 * "Strong" for anything above 3.
 */
export function scorePassword(value: string): PasswordStrengthLevel {
  let score = 0
  if (value.length >= 8) score++
  if (/[A-Z]/.test(value)) score++
  if (/[a-z]/.test(value)) score++
  if (/[0-9]/.test(value)) score++
  if (/[!@#$%^&*(),.?"':{}|<>]/.test(value)) score++
  return Math.min(score, 4) as PasswordStrengthLevel
}