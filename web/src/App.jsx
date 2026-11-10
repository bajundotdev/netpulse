import { useMonitor } from './state/MonitorContext.jsx'

export default function App() {
  const { state } = useMonitor()
  return (
    <div className="container py-3">
      <h1 className="h4">NetPulse</h1>
      <p className="text-muted">
        {state.connected ? 'Live' : 'Connecting...'} - {state.order.length} devices
      </p>
    </div>
  )
}
