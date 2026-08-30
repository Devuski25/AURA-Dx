/**
 * AURA-Dx Cloudflare Worker
 *
 * Serves the frontend SPA via Cloudflare's Static Assets binding.
 * All requests are handled by the asset binding (configured in wrangler.jsonc).
 * For any unmatched route (e.g., /auth/callback, /dashboard), the asset binding
 * automatically serves /index.html so React Router can resolve it client-side.
 *
 * No custom logic needed — static assets handle everything.
 */

export default {
  async fetch(request, env) {
    // Delegate to the static assets binding (configured in wrangler.jsonc).
    // If the requested path matches a static file, serve it.
    // Otherwise, fall back to index.html (SPA routing).
    return env.ASSETS.fetch(request);
  },
};