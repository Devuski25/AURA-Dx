export const API_BASE = import.meta.env.VITE_API_URL ?? "https://aura-dx.xyz"

export function getApiUrl(path: string): string {
  return `${API_BASE}${path}`
}