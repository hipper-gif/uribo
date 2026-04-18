import { useState, useMemo, Fragment } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { FISCAL_MONTHS, MONTH_LABELS, EXPENSE_CATEGORIES, MGMT_FEE_CODE, currentFiscalYear, formatPercent, formatMan } from '../lib/types'

export function MonthlyReport() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: actualData, loading } = useMonthlyData(storeId, fiscalYear, '実績')
  const { data: targetData } = useMonthlyData(storeId, fiscalYear, '目標')

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated && i.item_code !== MGMT_FEE_CODE).sort((a, b) => a.sort_order - b.sort_order), [items])
  const salesItems = useMemo(() =>
    displayItems.filter(i => i.item_category === '売上'), [displayItems])
  const expenseGroups = useMemo(() => {
    const groups: Record<string, typeof displayItems> = {}
    for (const cat of EXPENSE_CATEGORIES) {
      const ci = displayItems.filter(i => i.item_category === cat)
      if (ci.length > 0) groups[cat] = ci
    }
    return groups
  }, [displayItems])

  const aLookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of actualData) { if (!map[d.item_id]) map[d.item_id] = {}; map[d.item_id][d.month] = (map[d.item_id][d.month] ?? 0) + parseFloat(d.amount) }
    return map
  }, [actualData])
  const tLookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of targetData) { if (!map[d.item_id]) map[d.item_id] = {}; map[d.item_id][d.month] = (map[d.item_id][d.month] ?? 0) + parseFloat(d.amount) }
    return map
  }, [targetData])

  const salesItem = items.find(i => i.item_code === 'sales')
  const customersItem = items.find(i => i.item_code === 'customers')
  const mgmtFeeItem = items.find(i => i.item_code === MGMT_FEE_CODE)
  const getA = (id: number, m: number) => aLookup[id]?.[m] ?? 0
  const getT = (id: number, m: number) => tLookup[id]?.[m] ?? 0
  const prevMonth = month === 4 ? 3 : month - 1
  const catTotal = (cat: string, lk: typeof aLookup, m: number) => (expenseGroups[cat] ?? []).reduce((s, i) => s + (lk[i.id]?.[m] ?? 0), 0)
  const allExp = (lk: typeof aLookup, m: number) => EXPENSE_CATEGORIES.reduce((s, c) => s + catTotal(c, lk, m), 0)

  const tSales = salesItem ? getT(salesItem.id, month) : 0
  const aSales = salesItem ? getA(salesItem.id, month) : 0
  const pSales = salesItem ? getA(salesItem.id, prevMonth) : 0
  const tExp = allExp(tLookup, month), aExp = allExp(aLookup, month), pExp = allExp(aLookup, prevMonth)
  const aMgmt = mgmtFeeItem ? getA(mgmtFeeItem.id, month) : 0
  const pMgmt = mgmtFeeItem ? getA(mgmtFeeItem.id, prevMonth) : 0
  const tProfit = tSales - tExp, aOpProfit = aSales - aExp, aProfit = aOpProfit - aMgmt
  const pOpProfit = pSales - pExp, pProfit = pOpProfit - pMgmt
  const aCust = customersItem ? getA(customersItem.id, month) : 0
  const tCust = customersItem ? getT(customersItem.id, month) : 0
  const aUnit = aCust ? aSales / aCust : 0, tUnit = tCust ? tSales / tCust : 0
  const achS = tSales ? aSales / tSales : 0, achE = tExp ? aExp / tExp : 0, achP = tProfit ? aOpProfit / tProfit : 0

  const toggle = (cat: string) => { setExpanded(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n }) }
  const store = storeId === 0 ? { name: '全店舗' } : stores.find(s => s.id === storeId)
  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)
  const qLabel = (m: number) => [4,5,6].includes(m) ? 'Q1' : [7,8,9].includes(m) ? 'Q2' : [10,11,12].includes(m) ? 'Q3' : 'Q4'

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 03 / MONTHLY</span>
            <h1 className="page-title">{MONTH_LABELS[month]}の成績</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · {store?.name ?? ''}</div>
        </div>
      </div>
      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => setStoreId(Number(e.target.value))}>
          <option value={0}>全店舗</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
      </div>
      <div className="filter-bar">
        <div className="month-strip">
          {FISCAL_MONTHS.map(m => (
            <button key={m} className="month-btn" aria-pressed={month === m} onClick={() => setMonth(m)}>
              <span>{MONTH_LABELS[m]}</span><span className="q">{qLabel(m)}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div> : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">売上</div>
              <div className="kpi-value">{formatMan(aSales)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {tSales > 0 && <span className={`kpi-delta ${achS >= 1 ? 'pos' : 'neg'}`}>{achS >= 1 ? '▲' : '▼'} {Math.abs((achS-1)*100).toFixed(1)}%</span>}
                <span>目標 {formatMan(tSales)}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">客数</div>
              <div className="kpi-value">{aCust ? aCust.toLocaleString() : '—'}<span className="unit">名</span></div>
              <div className="kpi-meta">
                {tCust > 0 && <span className={`kpi-delta ${aCust/tCust >= 1 ? 'pos' : 'neg'}`}>{aCust/tCust >= 1 ? '▲' : '▼'} {Math.abs(((aCust/tCust)-1)*100).toFixed(1)}%</span>}
                <span>客単価 {aUnit ? Math.round(aUnit).toLocaleString() : '—'}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">支出合計</div>
              <div className="kpi-value">{formatMan(aExp)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {tExp > 0 && <span className={`kpi-delta ${achE <= 1 ? 'pos' : 'neg'}`}>{achE <= 1 ? '▼' : '▲'} {Math.abs((achE-1)*100).toFixed(1)}%</span>}
                <span>目標 {formatMan(tExp)}円</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">営業利益</div>
              <div className="kpi-value">{formatMan(aOpProfit)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {tProfit !== 0 && <span className={`kpi-delta ${achP >= 1 ? 'pos' : 'neg'}`}>{achP >= 1 ? '▲' : '▼'} {Math.abs((achP-1)*100).toFixed(1)}%</span>}
                {aMgmt > 0 && <span style={{ color: 'var(--ink-3)' }}>純利益 {formatMan(aProfit)}</span>}
              </div>
            </div>
          </div>

          <div className="split">
            <div className="card" style={{ padding: 0 }}>
              <div className="card-head">
                <div className="card-title"><span className="index">DETAIL</span>{MONTH_LABELS[month]}の科目一覧</div>
                <span className="smallcaps">目標 · 実績 · 前月比</span>
              </div>
              <div className="table-scroll">
                <table className="ltable">
                  <thead><tr>
                    <th className="col-label">科目</th>
                    <th className="num-target">目標</th><th>実績</th><th>達成</th><th>進捗</th>
                    <th className="num-dim">前月</th><th>前月比</th>
                  </tr></thead>
                  <tbody>
                    {salesItems.map(item => {
                      const t = getT(item.id, month), a = getA(item.id, month), p = getA(item.id, prevMonth)
                      const ach = t ? a/t : 0, mom = p ? a/p : 0
                      const isCust = item.item_code === 'customers', isPrimary = item.item_code === 'sales'
                      return (
                        <tr key={item.id} className={isPrimary ? 'emphasis' : ''}>
                          <td className="col-label">{item.item_name}</td>
                          <td className="num num-target">{t ? (isCust ? t.toLocaleString() : formatMan(t)) : '—'}</td>
                          <td className="num">{a ? (isCust ? a.toLocaleString() : formatMan(a)) : '—'}</td>
                          <td className={`num ${ach >= 1 ? 'num-pos' : ach > 0 ? 'num-neg' : 'num-dim'}`}>{t && a ? formatPercent(ach) : '—'}</td>
                          <td style={{ minWidth: 80 }}>{t && a ? <div className="progress" style={{ width: 70 }}><div className={`fill ${ach >= 1 ? 'pos' : ''}`} style={{ width: `${Math.min(100, ach*100)}%` }}/></div> : '—'}</td>
                          <td className="num num-dim">{p ? (isCust ? p.toLocaleString() : formatMan(p)) : '—'}</td>
                          <td className={`num ${mom >= 1 ? 'num-pos' : mom > 0 ? 'num-neg' : 'num-dim'}`}>{p && a ? formatPercent(mom) : '—'}</td>
                        </tr>
                      )
                    })}
                    {EXPENSE_CATEGORIES.map(cat => {
                      const ci = expenseGroups[cat]; if (!ci || !ci.length) return null
                      const isOpen = expanded.has(cat)
                      const t = catTotal(cat, tLookup, month), a = catTotal(cat, aLookup, month), p = catTotal(cat, aLookup, prevMonth)
                      const ach = t ? a/t : 0, mom = p ? a/p : 0
                      return (
                        <Fragment key={cat}>
                          <tr className="cat-row" aria-expanded={isOpen} onClick={() => toggle(cat)}>
                            <td className="col-label"><span className="caret">▶</span>{cat}</td>
                            <td className="num num-target">{t ? formatMan(t) : '—'}</td>
                            <td className="num">{a ? formatMan(a) : '—'}</td>
                            <td className={`num ${ach && ach <= 1 ? 'num-pos' : 'num-neg'}`}>{t && a ? formatPercent(ach) : '—'}</td>
                            <td>{t && a ? <div className="progress" style={{ width: 70 }}><div className={`fill ${ach <= 1 ? 'pos' : 'neg'}`} style={{ width: `${Math.min(100, ach*100)}%` }}/></div> : '—'}</td>
                            <td className="num num-dim">{p ? formatMan(p) : '—'}</td>
                            <td className={`num ${mom && mom <= 1 ? 'num-pos' : 'num-neg'}`}>{p && a ? formatPercent(mom) : '—'}</td>
                          </tr>
                          {isOpen && ci.map(item => {
                            const it = getT(item.id, month), ia = getA(item.id, month), ip = getA(item.id, prevMonth)
                            const iach = it ? ia/it : 0, imom = ip ? ia/ip : 0
                            return (
                              <tr key={item.id} className="sub-row">
                                <td className="col-label">{item.item_name}</td>
                                <td className="num num-target">{it ? formatMan(it) : '—'}</td>
                                <td className="num">{ia ? formatMan(ia) : '—'}</td>
                                <td className={`num ${iach && iach <= 1 ? 'num-pos' : 'num-neg'}`}>{it && ia ? formatPercent(iach) : '—'}</td>
                                <td />
                                <td className="num num-dim">{ip ? formatMan(ip) : '—'}</td>
                                <td className={`num ${imom && imom <= 1 ? 'num-pos' : 'num-neg'}`}>{ip && ia ? formatPercent(imom) : '—'}</td>
                              </tr>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                    <tr className="total-row">
                      <td className="col-label">支出合計</td>
                      <td className="num num-target">{formatMan(tExp)}</td>
                      <td className="num">{formatMan(aExp)}</td>
                      <td className={`num ${achE <= 1 ? 'num-pos' : 'num-neg'}`}>{tExp ? formatPercent(achE) : '—'}</td>
                      <td /><td className="num num-dim">{formatMan(pExp)}</td>
                      <td className={`num ${aExp <= pExp ? 'num-pos' : 'num-neg'}`}>{pExp ? formatPercent(aExp/pExp) : '—'}</td>
                    </tr>
                    <tr className="profit-row">
                      <td className={`col-label ${aOpProfit < 0 ? 'cell-loss' : ''}`}>営業利益</td>
                      <td className={`num num-target ${tProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(tProfit)}</td>
                      <td className={`num ${aOpProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(aOpProfit)}</td>
                      <td className="num">{tProfit ? formatPercent(achP) : '—'}</td>
                      <td /><td className="num num-dim">{formatMan(pOpProfit)}</td>
                      <td className="num">{pOpProfit ? formatPercent(aOpProfit/pOpProfit) : '—'}</td>
                    </tr>
                    {aMgmt > 0 && (
                      <>
                        <tr className="mgmt-fee-row">
                          <td className="col-label" style={{ paddingLeft: 24, color: 'var(--ink-3)' }}>Twinkle代</td>
                          <td className="num num-target" style={{ color: 'var(--ink-3)' }}>—</td>
                          <td className="num" style={{ color: 'var(--ink-3)' }}>{formatMan(aMgmt)}</td>
                          <td /><td /><td className="num num-dim">{pMgmt ? formatMan(pMgmt) : '—'}</td><td />
                        </tr>
                        <tr className="profit-row">
                          <td className={`col-label ${aProfit < 0 ? 'cell-loss' : ''}`}>純利益</td>
                          <td className="num num-target">—</td>
                          <td className={`num ${aProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(aProfit)}</td>
                          <td /><td /><td className="num num-dim">{formatMan(pProfit)}</td>
                          <td className="num">{pProfit ? formatPercent(aProfit/pProfit) : '—'}</td>
                        </tr>
                      </>
                    )}
                    <tr className="rate-row">
                      <td className="col-label">利益率</td>
                      <td className="num num-target">{tSales ? formatPercent(tProfit/tSales) : '—'}</td>
                      <td className="num">{aSales ? formatPercent(aProfit/aSales) : '—'}</td>
                      <td /><td />
                      <td className="num num-dim">{pSales ? formatPercent(pProfit/pSales) : '—'}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card">
                <div className="card-head">
                  <div className="card-title"><span className="index">SNAPSHOT</span>サマリー</div>
                  <span className="chip accent">{MONTH_LABELS[month]}</span>
                </div>
                <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <div className="smallcaps" style={{ marginBottom: 4 }}>売上 対目標</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="tnum" style={{ fontSize: 22, fontWeight: 600 }}>{tSales ? formatPercent(achS) : '—'}</span>
                      <span className="tnum" style={{ color: 'var(--ink-3)', fontSize: 12 }}>{formatMan(aSales)} / {formatMan(tSales)}</span>
                    </div>
                    <div className="progress" style={{ marginTop: 6 }}>
                      <div className={`fill ${achS >= 1 ? 'pos' : ''}`} style={{ width: `${Math.min(100, achS*100)}%` }}/>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <div className="smallcaps" style={{ marginBottom: 2 }}>客数</div>
                      <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>{aCust ? aCust.toLocaleString() : '—'}</div>
                      {tCust > 0 && <div className="tnum" style={{ fontSize: 11, color: 'var(--ink-3)' }}>目標 {tCust.toLocaleString()}</div>}
                    </div>
                    <div>
                      <div className="smallcaps" style={{ marginBottom: 2 }}>客単価</div>
                      <div className="tnum" style={{ fontSize: 18, fontWeight: 600 }}>{aUnit ? '¥'+Math.round(aUnit).toLocaleString() : '—'}</div>
                      {tUnit > 0 && <div className="tnum" style={{ fontSize: 11, color: 'var(--ink-3)' }}>目標 ¥{Math.round(tUnit).toLocaleString()}</div>}
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
                    <div className="smallcaps" style={{ marginBottom: 8 }}>費用内訳</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {EXPENSE_CATEGORIES.map(cat => {
                        const v = catTotal(cat, aLookup, month)
                        const max = Math.max(...EXPENSE_CATEGORIES.map(c => catTotal(c, aLookup, month)), 1)
                        return (
                          <div key={cat} className="hbar">
                            <span className="label">{cat}</span>
                            <div className="track"><div className="fill" style={{ width: `${Math.min(100, (v/max)*100)}%` }}/></div>
                            <span className="value">{formatMan(v)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
