import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { client } from './client'
import { syncAppearance } from './appearance'
import './theme.css'
import './styles.css'
import './service.css'
import './settings.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <main className="startup-fallback"><h1>应用暂时无法显示</h1><p>请重新打开应用后重试。</p><button className="button" onClick={() => location.reload()}>重新加载</button></main> : this.props.children }
}
const stop = syncAppearance(), root = createRoot(document.getElementById('root')!)
root.render(<ErrorBoundary><App /></ErrorBoundary>)
window.addEventListener('pagehide', () => { stop(); client?.dispose(); root.unmount() }, { once: true })
