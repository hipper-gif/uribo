import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { AnnualView } from './pages/AnnualView'
import { QuarterlyView } from './pages/QuarterlyView'
import { MonthlyReport } from './pages/MonthlyReport'
import { DataEntry } from './pages/DataEntry'
import { TargetSetting } from './pages/TargetSetting'

const NAV = [
  { to: '/', label: '年間' },
  { to: '/quarterly', label: '四半期' },
  { to: '/monthly', label: '月次' },
  { to: '/entry', label: '入力' },
  { to: '/targets', label: '目標' },
]

export default function App() {
  return (
    <BrowserRouter basename="/uribo">
      <div className="min-h-screen bg-gray-50 pb-16 lg:pb-0">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 flex items-center h-14">
            <h1 className="text-lg font-bold text-gray-900 mr-4 shrink-0">🐗 うりぼー</h1>
            <nav className="flex gap-1 overflow-x-auto scrollbar-hide">
              {NAV.map(n => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'}
                  className={({ isActive }) =>
                    `px-4 py-2.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap min-h-[44px] flex items-center ${
                      isActive ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                    }`
                  }>{n.label}</NavLink>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-4">
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
