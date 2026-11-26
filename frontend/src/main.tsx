import React from 'react'
import ReactDOM from 'react-dom/client'
import { SWRConfig } from 'swr'
import App from './App'
import { NotificationProvider } from './context/NotificationContext'
import { i18nReady } from './i18n'
import { initSentry } from './services/sentry'
import './styles/global.css'

async function prepareApp() {
  // Initialise Sentry before any component renders so error boundaries can
  // capture exceptions with the correct DSN.  Uses VITE_SENTRY_DSN; falls
  // back to a no-op if the env var is absent or @sentry/react is not installed.
  await initSentry()

  // Wait for i18next before the first render so the UI never paints raw
  // translation keys.
  await i18nReady

  // Always prepare MSW if we're in dev or test mode.
  // We can check if mockServiceWorker.js is present or just import mocks.
  if (import.meta.env.DEV || import.meta.env.MODE === 'test' || window.location.hostname === 'localhost') {
    try {
      const { worker } = await import('./mocks/browser')
      if (import.meta.env.DEV && localStorage.getItem('ai-net-visual-fixtures') === 'true') {
        const { visualHandlers } = await import('../tests/visual/fixtures/handlers')
        worker.use(...visualHandlers)
      }
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: {
          url: '/mockServiceWorker.js',
        }
      })
    } catch (e) {
      console.warn('MSW failed to start', e)
    }
  }
}

prepareApp().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <SWRConfig value={{ dedupingInterval: 5_000, revalidateOnFocus: true, errorRetryCount: 3 }}>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </SWRConfig>
    </React.StrictMode>,
  )
})
