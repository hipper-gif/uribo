import { useState, useMemo, Fragment } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { MONTH_LABELS, EXPENSE_CATEGORIES, currentFiscalYear, formatPercent, formatMan } from '../lib/types'

const QUARTERS = [
  { label: 'Q1', months: [4, 5, 6], sub: '4 – 6月' },
  { label: 'Q2', months: [7, 8, 9], sub: '7 – 9月' },
  { label: 'Q3', months: [10, 11, 12], sub: '10 – 12月' },
  { label: 'Q4', months: [1, 2, 3], sub: '1 – 3月' },
]

export function QuarterlyView() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [quarter, setQuarter] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: actualData, loading } = useMonthlyData(storeId, fiscalYear, '実績')
  const { data: targetData } = useMonthlyData(storeId, fiscalYear, '目標')

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated).sort((a, b) => a.sort_order - b.sort_order), [items])

  const salesItems = useMemo(() =>
    displayItems.filter(i => i.item_category === '売上'), [displayItems])

  const expenseGroups = useMemo(() => {
    const groups: Record<string, typeof displayItems> = {}
    for (const cat of EXPENSE_CATEGORIES) {
      const catItems = displayItems.filter(i => i.item_category === cat)
      if (catItems.length > 0) groups[cat] = catItems
    }
    return groups
  }, [displayItems])

  const aLookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of actualData) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = parseFloat(d.amount)
    }
    return map
  }, [actualData])

  const tLookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of targetData) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = parseFloat(d.amount)
    }
    return map
  }, [targetData])

  const salesItem = items.find(i => i.item_code === 'sales')
  const q = QUARTERS[quarter]

  const getA = (itemId: number, m: number) => aLookup[itemId]?.[m] ?? 0
  const getT = (itemId: number, m: number) => tLookup[itemId]?.[m] ?? 0

  const qSumItem = (itemId: number, lk: typeof aLookup) => q.months.reduce((s, m) => s + (lk[itemId]?.[m] ?? 0), 0)
  const qSumCat = (cat: string, lk: typeof aLookup) => (expenseGroups[cat] ?? []).reduce((s, it) => s + qSumItem(it.id, lk), 0)
  const qAllExp = (lk: typeof aLookup) => EXPENSE_CATEGORIES.reduce((s, c) => s + qSumCat(c, lk), 0)

  const qActualSales = salesItem ? qSumItem(salesItem.id, aLookup) : 0
  const qTargetSales = salesItem ? qSumItem(salesItem.id, tLookup) : 0
  const qActualExp = qAllExp(aLookup)
  const qTargetExp = qAllExp(tLookup)
  const qActualProfit = qActualSales - qActualExp
  const qTargetProfit = qTargetSales - qTargetExp
  const salesAch = qTargetSales ? qActualSales / qTargetSales : 0

  const toggle = (cat: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  }

  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 02 / QUARTERLY</span>
            <h1 className="page-title">四半期成績</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · 目標と実績の対比</div>
        </div>
      </div>

      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => setStoreId(Number(e.target.value))}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
      </div>

      <div className="filter-bar">
        <div className="month-strip">
          {QUARTERS.map((qq, i) => (
            <button key={i} className="month-btn" aria-pressed={quarter === i}
              onClick={() => setQuarter(i)}>
              <span>{qq.label}</span>
              <span className="q">{qq.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div> : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">四半期売上</div>
              <div className="kpi-value">{formatMan(qActualSales)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {qTargetSales > 0 && (
                  <span className={`kpi-delta ${salesAch >= 1 ? 'pos' : 'neg'}`}>
                    {salesAch >= 1 ? '▲' : '▼'} {Math.abs((salesAch - 1) * 100).toFixed(1)}%
                  </span>
                )}
                <span>目標 {formatMan(qTargetSales)}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">支出合計</div>
              <div className="kpi-value">{formatMan(qActualExp)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {qTargetExp > 0 && (
                  <span className={`kpi-delta ${qActualExp / qTargetExp <= 1 ? 'pos' : 'neg'}`}>
                    {qActualExp / qTargetExp <= 1 ? '▼' : '▲'} {Math.abs(((qActualExp / qTargetExp) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                <span>目標 {formatMan(qTargetExp)}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">純利益</div>
              <div className="kpi-value">{formatMan(qActualProfit)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {qTargetProfit !== 0 && (
                  <span className={`kpi-delta ${qActualProfit / qTargetProfit >= 1 ? 'pos' : 'neg'}`}>
                    {qActualProfit / qTargetProfit >= 1 ? '▲' : '▼'} {Math.abs(((qActualProfit / qTargetProfit) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                <span>目標 {formatMan(qTargetProfit)}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">達成率</div>
              <div className="kpi-value">{qTargetSales ? (salesAch * 100).toFixed(1) : '—'}<span className="unit">%</span></div>
              <div className="kpi-meta"><span>売上達成率</span></div>
            </div>
          </div>

          <div className="split">
            <div className="card" style={{ padding: 0 }}>
              <div className="card-head">
                <div className="card-title"><span className="index">TABLE</span>月次 × 科目</div>
                <span className="smallcaps">単位: 円</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ltable">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="col-label" style={{ verticalAlign: 'bottom' }}>科目</th>
                      {q.months.map(m => <th key={m} colSpan={3} style={{ textAlign: 'center', borderLeft: '1px solid var(--rule)' }}>{MONTH_LABELS[m]}</th>)}
                      <th colSpan={3} className="tot-col" style={{ textAlign: 'center' }}>四半期合計</th>
                    </tr>
                    <tr>
                      {[...q.months, 0].map((m, i) => (
                        <Fragment key={`h-${m}-${i}`}>
                          <th className="num-target" style={i === 0 ? { borderLeft: '1px solid var(--rule)' } : undefined}>目標</th>
                          <th>実績</th>
                          <th>達成</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesItems.map(item => {
                      const isPrimary = item.item_code === 'sales'
                      const isCust = item.item_code === 'customers'
                      const qT = qSumItem(item.id, tLookup)
                      const qA = qSumItem(item.id, aLookup)
                      return (
                        <tr key={item.id} className={isPrimary ? 'emphasis' : ''}>
                          <td className="col-label">{item.item_name}</td>
                          {q.months.map(m => {
                            const t = getT(item.id, m)
                            const a = getA(item.id, m)
                            const r = t ? a / t : 0
                            return (
                              <Fragment key={m}>
                                <td className="num num-target">{t ? (isCust ? t.toLocaleString() : formatMan(t)) : '—'}</td>
                                <td className="num">{a ? (isCust ? a.toLocaleString() : formatMan(a)) : <span className="num-dim">—</span>}</td>
                                <td className={`num ${r >= 1 ? 'num-pos' : r > 0 ? 'num-neg' : 'num-dim'}`}>{t && a ? formatPercent(r) : '—'}</td>
                              </Fragment>
                            )
                          })}
                          <td className="num tot-col num-target">{qT ? (isCust ? qT.toLocaleString() : formatMan(qT)) : '—'}</td>
                          <td className="num tot-col">{qA ? (isCust ? qA.toLocaleString() : formatMan(qA)) : '—'}</td>
                          <td className={`num tot-col ${qT && qA ? (qA / qT >= 1 ? 'num-pos' : 'num-neg') : 'num-dim'}`}>{qT && qA ? formatPercent(qA / qT) : '—'}</td>
                        </tr>
                      )
                    })}

                    {EXPENSE_CATEGORIES.map(cat => {
                      const catItems = expenseGroups[cat]
                      if (!catItems || catItems.length === 0) return null
                      const isOpen = expanded.has(cat)
                      const qT = qSumCat(cat, tLookup)
                      const qA = qSumCat(cat, aLookup)
                      return (
                        <Fragment key={cat}>
                          <tr className="cat-row" aria-expanded={isOpen} onClick={() => toggle(cat)}>
                            <td className="col-label"><span className="caret">▶</span>{cat}</td>
                            {q.months.map(m => {
                              const t = catItems.reduce((s, it) => s + getT(it.id, m), 0)
                              const a = catItems.reduce((s, it) => s + getA(it.id, m), 0)
                              return (
                                <Fragment key={m}>
                                  <td className="num num-target">{t ? formatMan(t) : '—'}</td>
                                  <td className="num">{a ? formatMan(a) : '—'}</td>
                                  <td className="num num-dim">—</td>
                                </Fragment>
                              )
                            })}
                            <td className="num tot-col num-target">{qT ? formatMan(qT) : '—'}</td>
                            <td className="num tot-col">{qA ? formatMan(qA) : '—'}</td>
                            <td className={`num tot-col ${qT && qA ? (qA / qT <= 1 ? 'num-pos' : 'num-neg') : ''}`}>{qT && qA ? formatPercent(qA / qT) : '—'}</td>
                          </tr>
                          {isOpen && catItems.map(item => {
                            const iQT = qSumItem(item.id, tLookup)
                            const iQA = qSumItem(item.id, aLookup)
                            return (
                              <tr key={item.id} className="sub-row">
                                <td className="col-label">{item.item_name}</td>
                                {q.months.map(m => {
                                  const t = getT(item.id, m)
                                  const a = getA(item.id, m)
                                  return (
                                    <Fragment key={m}>
                                      <td className="num num-target">{t ? formatMan(t) : '—'}</td>
                                      <td className="num">{a ? formatMan(a) : <span className="num-dim">—</span>}</td>
                                      <td className="num num-dim">—</td>
                                    </Fragment>
                                  )
                                })}
                                <td className="num tot-col num-target">{iQT ? formatMan(iQT) : '—'}</td>
                                <td className="num tot-col">{iQA ? formatMan(iQA) : '—'}</td>
                                <td className="num tot-col num-dim">—</td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}

                    <tr className={`profit-row ${qActualProfit < 0 ? 'loss' : ''}`}>
                      <td className="col-label">純利益</td>
                      {q.months.map(m => {
                        const aS = salesItem ? getA(salesItem.id, m) : 0
                        const tS = salesItem ? getT(salesItem.id, m) : 0
                        const aE = EXPENSE_CATEGORIES.reduce((s, c) => s + (expenseGroups[c] ?? []).reduce((ss, it) => ss + getA(it.id, m), 0), 0)
                        const tE = EXPENSE_CATEGORIES.reduce((s, c) => s + (expenseGroups[c] ?? []).reduce((ss, it) => ss + getT(it.id, m), 0), 0)
                        const aP = aS - aE, tP = tS - tE
                        const r = tP ? aP / tP : 0
                        return (
                          <Fragment key={m}>
                            <td className="num num-target">{tS ? formatMan(tP) : '—'}</td>
                            <td className="num">{aS ? formatMan(aP) : '—'}</td>
                            <td className={`num ${r >= 1 ? 'num-pos' : r > 0 ? 'num-neg' : 'num-dim'}`}>{tP && aS ? formatPercent(r) : '—'}</td>
                          </Fragment>
                        )
                      })}
                      <td className="num tot-col num-target">{formatMan(qTargetProfit)}</td>
                      <td className="num tot-col">{formatMan(qActualProfit)}</td>
                      <td className={`num tot-col ${qTargetProfit ? (qActualProfit / qTargetProfit >= 1 ? 'num-pos' : 'num-neg') : ''}`}>
                        {qTargetProfit ? formatPercent(qActualProfit / qTargetProfit) : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div className="card-head"><div className="card-title"><span className="index">BREAKDOWN</span>費用構成</div></div>
                <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {EXPENSE_CATEGORIES.map(cat => {
                    const v = qSumCat(cat, aLookup)
                    const t = qSumCat(cat, tLookup)
                    const max = Math.max(...EXPENSE_CATEGORIES.map(c => Math.max(qSumCat(c, aLookup), qSumCat(c, tLookup))), 1)
                    const w = Math.min(100, (v / max) * 100)
                    const tw = t ? Math.min(100, (t / max) * 100) : null
                    return (
                      <div key={cat} className="hbar">
                        <span className="label">{cat}</span>
                        <div className="track">
                          <div className="fill" style={{ width: `${w}%` }} />
                          {tw !== null && <div className="fill-target" style={{ left: `${tw}%` }} />}
                        </div>
                        <span className="value">{formatMan(v)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
