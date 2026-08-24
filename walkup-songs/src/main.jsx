import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The app previously registered a service worker (sw.js) for offline
// caching. It caused a recurring class of bug after deploys: the SW served a
// cached index.html + old JS bundle, so phones kept running stale code with
// no album art / broken features. Assets are content-hashed (a fresh
// index.html always references the right bundle), so we now skip the SW
// entirely and unregister any leftover registration, deleting its caches.
// This guarantees every load is fresh.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister())
    })
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
    }
  })
}
