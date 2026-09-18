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
    const url = new URL(request.url);

    // Item 12: this app handles patient health information — plaintext HTTP is
    // never acceptable. Browsers only omit the TLS upgrade for http:// links
    // typed manually, so redirect them (and any stray API callers) to HTTPS.
    // HTTPS requests (the only kind normal users ever make) skip this branch,
    // and zone-level Always Use HTTPS covers anything that bypasses the Worker.
    if (url.protocol === "http:") {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }

    // Delegate to the static assets binding (configured in wrangler.jsonc).
    // If the requested path matches a static file, serve it.
    // Otherwise, fall back to index.html (SPA routing).
    return env.ASSETS.fetch(request);
  },
};