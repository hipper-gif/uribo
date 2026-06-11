import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { AnnualView } from './pages/AnnualView'
import { QuarterlyView } from './pages/QuarterlyView'
import { MonthlyReport } from './pages/MonthlyReport'
import { DataEntry } from './pages/DataEntry'
import { TargetSetting } from './pages/TargetSetting'
import { Payroll } from './pages/Payroll'
import { TkcCompare } from './pages/TkcCompare'

// ボトムタブ用ラインアイコン(上部の印刷アイコンと同じストローク言語。currentColorでアクティブ色追従)
const svgProps = {
  width: 21, height: 21, viewBox: '0 0 20 20', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.5,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}
const BarIcon = () => (
  <svg {...svgProps}><path d="M3 16.5h14" /><rect x="4.4" y="11" width="2.7" height="5.5" rx="0.7" /><rect x="8.65" y="7.5" width="2.7" height="9" rx="0.7" /><rect x="12.9" y="4" width="2.7" height="12.5" rx="0.7" /></svg>
)
const CalendarIcon = () => (
  <svg {...svgProps}><rect x="3.3" y="4.8" width="13.4" height="11.7" rx="1.6" /><path d="M3.3 8.3h13.4M7 3.2v3M13 3.2v3" /></svg>
)
const PencilIcon = () => (
  <svg {...svgProps}><path d="M13.4 4.4l2.2 2.2-8.3 8.3-2.9.7.7-2.9 8.3-8.3z" /><path d="M11.9 5.9l2.2 2.2" /></svg>
)
const YenIcon = () => (
  <svg {...svgProps}><circle cx="10" cy="10" r="6.6" /><path d="M7.7 6.9l2.3 2.9 2.3-2.9M10 9.8v4.1M7.9 11h4.2M7.9 12.6h4.2" /></svg>
)

const NAV = [
  { to: '/', label: '年間', idx: '01' },
  { to: '/quarterly', label: '四半期', idx: '02' },
  { to: '/monthly', label: '月次', idx: '03' },
  { to: '/entry', label: '入力', idx: '04' },
  { to: '/targets', label: '目標', idx: '05' },
  { to: '/payroll', label: '給与', idx: '06' },
]

// 管理者専用ナビ(?admin=1 で表示)
const ADMIN_NAV = [
  { to: '/tkc-compare', label: 'TKC比較', idx: '★' },
]

const NICOLIO_HOME = 'https://twinklemark.xsrv.jp/nicolio/'
const AUTH_URL = (import.meta.env.VITE_API_URL as string).replace('/api.php', '') + '/auth.php'

type AuthState = 'loading' | 'ok' | 'unauthed' | 'denied'

/**
 * 認証ゲート: うりぼーは給与・売上データを扱うため、
 * Nicolio セッション（admin/sysadmin ロール）必須。
 * 2026-06-11 以前は埋め込みトークンで誰でも閲覧できる状態だった。
 */
function useAuthGate(): AuthState {
  const [state, setState] = useState<AuthState>('loading')
  useEffect(() => {
    let cancelled = false
    fetch(`${AUTH_URL}?action=me`, { credentials: 'include' })
      .then(async res => {
        if (cancelled) return
        if (!res.ok) { setState('unauthed'); return }
        const data = await res.json()
        const role = data?.user?.role
        setState(role === 'admin' || role === 'sysadmin' ? 'ok' : 'denied')
      })
      .catch(() => { if (!cancelled) setState('unauthed') })
    return () => { cancelled = true }
  }, [])
  return state
}

function AuthMessage({ state }: { state: AuthState }) {
  return (
    <div style={{ textAlign: 'center', padding: '80px 24px', fontFamily: 'sans-serif' }}>
      {state === 'loading' && <p>認証確認中…</p>}
      {state === 'unauthed' && (
        <>
          <p style={{ marginBottom: 16 }}>うりぼーの利用には Nicolio へのログインが必要です</p>
          <a href={NICOLIO_HOME} style={{ color: '#2563eb' }}>Nicolio でログインする</a>
        </>
      )}
      {state === 'denied' && (
        <p>うりぼー（売上・給与）は管理者限定です。アクセス権が必要な場合は管理者に連絡してください。</p>
      )}
    </div>
  )
}

export default function App() {
  const auth = useAuthGate()
  // URL に ?admin=1 が含まれていれば管理者モード(LocalStorage に保存)
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('admin') === '1') localStorage.setItem('uribo_admin', '1')
    if (sp.get('admin') === '0') localStorage.removeItem('uribo_admin')
  }
  const isAdmin = typeof window !== 'undefined' && localStorage.getItem('uribo_admin') === '1'
  const navItems = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV
  if (auth !== 'ok') return <AuthMessage state={auth} />
  return (
    <BrowserRouter basename="/uribo">
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <img src="/uribo/icon-192.png" alt="うりぼー" className="brand-logo" />
            <div className="brand-text">
              <span className="brand-name">うりぼー</span>
              <span className="brand-sub">BEAUTY · SALES OS</span>
            </div>
          </div>
          <nav className="nav scrollbar-hide">
            {navItems.map(n => (
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
            <Route path="/payroll" element={<Payroll />} />
            <Route path="/tkc-compare" element={<TkcCompare />} />
          </Routes>
        </main>
        {/* スマホ用ボトムタブ(主要4タブ) */}
        <nav className="bottom-tabs">
          {[
            { to: '/', label: '年間', icon: <BarIcon /> },
            { to: '/monthly', label: '月次', icon: <CalendarIcon /> },
            { to: '/entry', label: '入力', icon: <PencilIcon /> },
            { to: '/payroll', label: '給与', icon: <YenIcon /> },
          ].map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => `bottom-tab${isActive ? ' active' : ''}`}>
              <span className="bt-icon">{n.icon}</span>
              <span className="bt-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </BrowserRouter>
  )
}
