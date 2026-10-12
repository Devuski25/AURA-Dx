import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/**
 * Dev builds only: serve `/api/*` from fixtures so the authenticated pages
 * render while the FastAPI backend is down.
 *
 * The mock is pulled in with a dynamic import rather than a static one. A
 * static import makes Rollup assume the module has side effects, so its
 * fixtures are evaluated and their data lands in the production bundle even
 * when `import.meta.env.DEV` is `false`. A dynamic import inside the dead
 * branch is dropped outright — verified by grepping `dist`.
 *
 * The app is mounted inside `boot` so the patch is in place before any
 * component can issue its first request; awaiting a bare static import here
 * would leave a window where effects fire against a dead socket.
 *
 * Set `VITE_DISABLE_API_MOCK=true` in `frontend-new/.env.local` to bypass the
 * mock entirely and hit the real backend. Needed for the recording flow: the
 * mock has no audio pipeline, so `POST /api/audio/upload` and
 * `POST /api/screenings` cannot be exercised while it is installed.
 */
async function boot(): Promise<void> {
  const mockDisabled = import.meta.env.VITE_DISABLE_API_MOCK === 'true'

  if (import.meta.env.DEV && !mockDisabled) {
    const { installDevApiMock } = await import('./lib/dev-mock-api')
    installDevApiMock()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void boot()