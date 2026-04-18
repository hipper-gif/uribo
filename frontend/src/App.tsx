import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { AnnualView } from './pages/AnnualView'
import { QuarterlyView } from './pages/QuarterlyView'
import { MonthlyReport } from './pages/MonthlyReport'
import { DataEntry } from './pages/DataEntry'
import { TargetSetting } from './pages/TargetSetting'

const NAV = [
  { to: '/', label: '年間', idx: '01' },
  { to: '/quarterly', label: '四半期', idx: '02' },
  { to: '/monthly', label: '月次', idx: '03' },
  { to: '/entry', label: '入力', idx: '04' },
  { to: '/targets', label: '目標', idx: '05' },
]

export default function App() {
  return (
    <BrowserRouter basename="/uribo">
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">U</div>
            <div className="brand-text">
              <span className="brand-name">うりぼー</span>
              <span className="brand-sub">BEAUTY · SALES OS</span>
            </div>
          </div>
          <nav className="nav scrollbar-hide">
            {NAV.map(n => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="nav-num">{n.idx}</span>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="pill"><span className="dot" />LIVE · {new Date().toLocaleDateString('ja-JP')}</span>
            <button className="icon-btn" title="印刷" onClick={() => window.print()}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="8" width="10" height="6" rx="1"/><path d="M4 8V3h8v5M4 11h8"/></svg>
            </button>
          </div>
        </header>
        <main className="page">
          <Routes>
            <Route path="/" element={<AnnualView />} />
            <Route path="/quarterly" element={<QuarterlyView />} />
            <Route path="/monthly" element={<MonthlyReport />} />
            <Route path="/entry" element={<DataEntry />} />
            <Route path="/targets" element={<TargetSetting />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
