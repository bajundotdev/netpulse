import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './app.css'
import App from './App.jsx'
import { createAlerter } from './alerts.js'
import { MonitorProvider } from './state/MonitorContext.jsx'
import { applyTheme, readTheme } from './state/theme.js'

applyTheme(readTheme())

const alerter = createAlerter()
window.addEventListener('focus', alerter.focus)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) alerter.focus()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MonitorProvider onEvent={alerter.push}>
      <App />
    </MonitorProvider>
  </StrictMode>,
)
