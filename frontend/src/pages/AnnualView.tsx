import { useState, useMemo, Fragment } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { FISCAL_MONTHS, MONTH_LABELS, EXPENSE_CATEGORIES, MGMT_FEE_CODE, currentFiscalYear, formatAmount, formatPercent, formatMan } from '../lib/types'
import type { DataType } from '../lib/types'

type CompareBase = 'target' | 'lastyear' | 'forecast'

export function AnnualView() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [dataType, setDataType] = useState<DataType>('実績')
  const [compareBase, setCompareBase] = useState<CompareBase>('target')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data, loading } = useMonthlyData(storeId, fiscalYear, dataType)
  const { data: targetData } = useMonthlyData(storeId, fiscalYear, '目標')

  // Compare data based on selected compare base
  const compareDataType = compareBase === 'target' ? '目標' : compareBase === 'forecast' ? '見通し' : undefined
  const compareFY = compareBase === 'lastyear' ? fiscalYear - 1 : fiscalYear
  const compareActualType = compareBase === 'lastyear' ? '実績' : undefined
  const { data: compareData } = useMonthlyData(storeId, compareFY, compareDataType ?? compareActualType)

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated && i.item_code !== MGMT_FEE_CODE).sort((a, b) => a.sort_order - b.sort_order), [items])

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

  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])
  const customersItem = useMemo(() => items.find(i => i.item_code === 'customers'), [items])
  const mgmtFeeItem = useMemo(() => items.find(i => i.item_code === MGMT_FEE_CODE), [items])

  // Lookup helpers
  const lookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of data) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = (map[d.item_id][d.month] ?? 0) + parseFloat(d.amount)
    }
    return map
  }, [data])

  const cmpLookup = useMemo(() => {
    if (dataType !== '実績') return {}
    const map: Record<number, Record<number, number>> = {}
    for (const d of compareData) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = (map[d.item_id][d.month] ?? 0) + parseFloat(d.amount)
    }
    return map
  }, [compareData, dataType])

  const tgtLookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of targetData) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = (map[d.item_id][d.month] ?? 0) + parseFloat(d.amount)
    }
    return map
  }, [targetData])

  function getVal(itemId: number, month: number): number {
    return lookup[itemId]?.[month] ?? 0
  }
  function getCmpVal(itemId: number, month: number): number {
    return cmpLookup[itemId]?.[month] ?? 0
  }
  function getRowTotal(itemId: number): number {
    return FISCAL_MONTHS.reduce((s, m) => s + getVal(itemId, m), 0)
  }
  function getCatTotal(cat: string, month: number): number {
    return (expenseGroups[cat] ?? []).reduce((s, i) => s + getVal(i.id, month), 0)
  }
  function getCmpCatTotal(cat: string, month: number): number {
    return (expenseGroups[cat] ?? []).reduce((s, i) => s + getCmpVal(i.id, month), 0)
  }
  function getExpenseTotal(month: number): number {
    return EXPENSE_CATEGORIES.reduce((s, cat) => s + getCatTotal(cat, month), 0)
  }
  function getSalesAmount(month: number): number {
    return salesItem ? getVal(salesItem.id, month) : 0
  }

  const toggle = (cat: string) => {
    setExpanded(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n })
  }

  // Management fee helpers
  function getMgmtFee(month: number): number {
    return mgmtFeeItem ? getVal(mgmtFeeItem.id, month) : 0
  }

  // KPI totals
  const totalSales = FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m), 0)
  const totalExp = FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)
  const totalMgmtFee = FISCAL_MONTHS.reduce((s, m) => s + getMgmtFee(m), 0)
  const totalOpProfit = totalSales - totalExp
  const totalNetProfit = totalOpProfit - totalMgmtFee
  const totalCust = customersItem ? FISCAL_MONTHS.reduce((s, m) => s + getVal(customersItem.id, m), 0) : 0
  const activeMonths = FISCAL_MONTHS.filter(m => getSalesAmount(m) > 0).length

  const tgtTotalSales = salesItem ? FISCAL_MONTHS.reduce((s, m) => s + (tgtLookup[salesItem.id]?.[m] ?? 0), 0) : 0
  const tgtTotalExp = FISCAL_MONTHS.reduce((s, m) =>
    s + EXPENSE_CATEGORIES.reduce((es, cat) =>
      es + (expenseGroups[cat] ?? []).reduce((is, i) => is + (tgtLookup[i.id]?.[m] ?? 0), 0), 0), 0)

  const cmpTotalSales = salesItem ? FISCAL_MONTHS.reduce((s, m) => s + (cmpLookup[salesItem.id]?.[m] ?? 0), 0) : 0
  const cmpTotalExp = FISCAL_MONTHS.reduce((s, m) =>
    s + EXPENSE_CATEGORIES.reduce((es, cat) =>
      es + (expenseGroups[cat] ?? []).reduce((is, i) => is + (cmpLookup[i.id]?.[m] ?? 0), 0), 0), 0)

  const compareLabel = compareBase === 'target' ? `目標 ${fiscalYear}年度` : compareBase === 'lastyear' ? `昨対 ${fiscalYear - 1}年度実績` : `見通し ${fiscalYear}年度`
  const hasCmpData = dataType === '実績' && Object.keys(cmpLookup).length > 0

  const storeName = storeId === 0 ? '全店舗' : (stores.find(s => s.id === storeId)?.name ?? '')
  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  return (
    <div>
      {/* Page head */}
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 01 / ANNUAL</span>
            <h1 className="page-title">年間成績一覧</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · {storeName} · データ期間 {activeMonths} ヶ月</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* DataType seg */}
          <div className="seg" role="tablist">
            {(['実績', '目標', '見通し'] as DataType[]).map(dt => (
              <button key={dt} className="seg-btn" aria-pressed={dataType === dt} onClick={() => setDataType(dt)}>
                <span>{dt}</span>
                <span className="sub">{{ '実績': 'ACTUAL', '目標': 'TARGET', '見通し': 'FORECAST' }[dt]}</span>
              </button>
            ))}
          </div>
          {/* Compare base seg (only when viewing actuals) */}
          {dataType === '実績' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="smallcaps">VS</span>
              <div className="seg" role="tablist">
                {([{ id: 'target', label: '目標', sub: 'TARGET' }, { id: 'lastyear', label: '昨対', sub: 'YoY' }, { id: 'forecast', label: '見通し', sub: 'FORECAST' }] as const).map(o => (
                  <button key={o.id} className="seg-btn" aria-pressed={compareBase === o.id} onClick={() => setCompareBase(o.id)}>
                    <span>{o.label}</span>
                    <span className="sub">{o.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar: store + year */}
      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => setStoreId(Number(e.target.value))}>
          <option value={0}>全店舗</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div>
      ) : data.length === 0 ? (
        <div style={{ background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 10, padding: '36px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6 }}>{fiscalYear}年度の{dataType}データはありません</div>
          <div style={{ fontSize: 13 }}>別の年度または「実績」を選択してください</div>
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">年間売上 · YTD</div>
              <div className="kpi-value">{formatMan(totalSales)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {dataType === '実績' && compareBase === 'target' && tgtTotalSales > 0 && activeMonths > 0 && (
                  <span className={`kpi-delta ${totalSales / (tgtTotalSales * activeMonths / 12) >= 1 ? 'pos' : 'neg'}`}>
                    {totalSales / (tgtTotalSales * activeMonths / 12) >= 1 ? '▲' : '▼'} {Math.abs(((totalSales / (tgtTotalSales * activeMonths / 12)) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                {dataType === '実績' && compareBase !== 'target' && hasCmpData && cmpTotalSales > 0 && (
                  <span className={`kpi-delta ${totalSales / cmpTotalSales >= 1 ? 'pos' : 'neg'}`}>
                    {totalSales / cmpTotalSales >= 1 ? '▲' : '▼'} {Math.abs(((totalSales / cmpTotalSales) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                <span>{dataType === '実績' ? (compareBase === 'target' ? 'vs 目標ペース' : compareBase === 'lastyear' ? 'vs 昨対' : 'vs 見通し') : ''}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">支出合計 · YTD</div>
              <div className="kpi-value">{formatMan(totalExp)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                {dataType === '実績' && compareBase === 'target' && tgtTotalExp > 0 && activeMonths > 0 && (
                  <span className={`kpi-delta ${totalExp / (tgtTotalExp * activeMonths / 12) <= 1 ? 'pos' : 'neg'}`}>
                    {totalExp / (tgtTotalExp * activeMonths / 12) <= 1 ? '▼' : '▲'} {Math.abs(((totalExp / (tgtTotalExp * activeMonths / 12)) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                {dataType === '実績' && compareBase !== 'target' && hasCmpData && cmpTotalExp > 0 && (
                  <span className={`kpi-delta ${totalExp / cmpTotalExp <= 1 ? 'pos' : 'neg'}`}>
                    {totalExp / cmpTotalExp <= 1 ? '▼' : '▲'} {Math.abs(((totalExp / cmpTotalExp) - 1) * 100).toFixed(1)}%
                  </span>
                )}
                <span>{dataType === '実績' ? (compareBase === 'target' ? 'vs 目標ペース' : compareBase === 'lastyear' ? 'vs 昨対' : 'vs 見通し') : ''}</span>
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">営業利益 · YTD</div>
              <div className="kpi-value">{formatMan(totalOpProfit)}<span className="unit">円</span></div>
              <div className="kpi-meta">
                <span className={`kpi-delta ${totalOpProfit >= 0 ? 'pos' : 'neg'}`}>
                  {totalSales ? formatPercent(totalOpProfit / totalSales) : '—'}
                </span>
                <span>利益率</span>
                {totalMgmtFee > 0 && <span style={{ marginLeft: 8, color: 'var(--ink-3)' }}>純利益 {formatMan(totalNetProfit)}</span>}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">客数 · YTD</div>
              <div className="kpi-value">{totalCust ? totalCust.toLocaleString() : '—'}<span className="unit">名</span></div>
              <div className="kpi-meta">
                <span>客単価 {totalCust ? formatAmount(Math.round(totalSales / totalCust)) : '—'}円</span>
              </div>
            </div>
          </div>

          {/* Ledger table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-head">
              <div className="card-title"><span className="index">TABLE</span>科目別月次ブレイクダウン</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {dataType === '実績' && (
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)', padding: '2px 8px',
                    borderRadius: 4, border: '1px solid var(--rule)',
                    color: hasCmpData ? 'var(--accent-ink)' : 'var(--ink-4)',
                    background: hasCmpData ? 'var(--accent-soft)' : 'transparent'
                  }}>
                    VS {compareLabel}{!hasCmpData && ' — データなし'}
                  </span>
                )}
                <span className="smallcaps">単位: 円</span>
                <button className="btn btn-ghost" onClick={() => setExpanded(new Set(EXPENSE_CATEGORIES))}>すべて展開</button>
                <button className="btn btn-ghost" onClick={() => setExpanded(new Set())}>折りたたむ</button>
              </div>
            </div>
            <div className="table-scroll">
              <table className="ltable">
                <thead>
                  <tr>
                    <th className="col-label">科目</th>
                    {FISCAL_MONTHS.map(m => <th key={m}>{MONTH_LABELS[m]}</th>)}
                    <th className="tot-col">合計</th>
                    <th className="tot-col">月平均</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sales items */}
                  {salesItems.map(item => {
                    const total = getRowTotal(item.id)
                    const isCust = item.item_code === 'customers'
                    const isPrimary = item.item_code === 'sales'
                    return (
                      <tr key={item.id} className={isPrimary ? 'emphasis' : ''}>
                        <td className="col-label">{item.item_name}</td>
                        {FISCAL_MONTHS.map(m => {
                          const v = getVal(item.id, m)
                          const cv = dataType === '実績' ? getCmpVal(item.id, m) : 0
                          const ach = v && cv ? v / cv : null
                          return (
                            <td key={m} className="num">
                              {v ? (isCust ? v.toLocaleString() : formatMan(v)) : <span className="num-dim">—</span>}
                              {ach !== null && <span className={`ach ${ach >= 1 ? 'pos' : 'neg'}`}>{formatPercent(ach)}</span>}
                            </td>
                          )
                        })}
                        <td className="num tot-col">{total ? (isCust ? total.toLocaleString() : formatMan(total)) : '—'}</td>
                        <td className="num tot-col num-muted">{total ? (isCust ? Math.round(total / 12).toLocaleString() : formatMan(total / 12)) : '—'}</td>
                      </tr>
                    )
                  })}

                  {/* Expense categories */}
                  {EXPENSE_CATEGORIES.map(cat => {
                    const catItems = expenseGroups[cat]
                    if (!catItems || catItems.length === 0) return null
                    const isOpen = expanded.has(cat)
                    const catAnnualTotal = FISCAL_MONTHS.reduce((s, m) => s + getCatTotal(cat, m), 0)
                    return (
                      <Fragment key={cat}>
                        <tr className="cat-row" aria-expanded={isOpen} onClick={() => toggle(cat)}>
                          <td className="col-label">
                            <span className="caret">▶</span>{cat}
                            <span className="chip" style={{ marginLeft: 10 }}>{catItems.length}</span>
                          </td>
                          {FISCAL_MONTHS.map(m => {
                            const v = getCatTotal(cat, m)
                            const cv = dataType === '実績' ? getCmpCatTotal(cat, m) : 0
                            const ach = v && cv ? v / cv : null
                            const isOver = ach && ach > 1
                            return (
                              <td key={m} className="num">
                                {v ? formatMan(v) : <span className="num-dim">—</span>}
                                {ach !== null && <span className={`ach ${isOver ? 'neg' : 'pos'}`}>{formatPercent(ach)}</span>}
                              </td>
                            )
                          })}
                          <td className="num tot-col">{catAnnualTotal ? formatMan(catAnnualTotal) : '—'}</td>
                          <td className="num tot-col num-muted">{catAnnualTotal ? formatMan(catAnnualTotal / 12) : '—'}</td>
                        </tr>
                        {isOpen && catItems.map(item => {
                          const total = getRowTotal(item.id)
                          return (
                            <tr key={item.id} className="sub-row">
                              <td className="col-label">{item.item_name}</td>
                              {FISCAL_MONTHS.map(m => {
                                const v = getVal(item.id, m)
                                return <td key={m} className="num">{v ? formatMan(v) : <span className="num-dim">—</span>}</td>
                              })}
                              <td className="num tot-col">{total ? formatMan(total) : '—'}</td>
                              <td className="num tot-col num-muted">{total ? formatMan(total / 12) : '—'}</td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}

                  {/* Total expenses */}
                  <tr className="total-row">
                    <td className="col-label">支出合計</td>
                    {FISCAL_MONTHS.map(m => {
                      const v = getExpenseTotal(m)
                      return <td key={m} className="num">{v ? formatMan(v) : '—'}</td>
                    })}
                    <td className="num tot-col">{formatMan(totalExp)}</td>
                    <td className="num tot-col num-muted">{formatMan(totalExp / 12)}</td>
                  </tr>

                  {/* Operating profit (before mgmt fee) */}
                  <tr className="profit-row">
                    <td className={`col-label ${totalOpProfit < 0 ? 'cell-loss' : ''}`}>営業利益</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m)
                      const e = getExpenseTotal(m)
                      const p = s - e
                      return <td key={m} className={`num ${s && p < 0 ? 'cell-loss' : ''}`}>{s ? formatMan(p) : '—'}</td>
                    })}
                    <td className={`num tot-col ${totalOpProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(totalOpProfit)}</td>
                    <td className={`num tot-col ${totalOpProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(totalOpProfit / 12)}</td>
                  </tr>

                  {/* Management fee (Twinkle代) */}
                  {totalMgmtFee > 0 && (
                    <tr className="mgmt-fee-row">
                      <td className="col-label" style={{ paddingLeft: 24, color: 'var(--ink-3)' }}>Twinkle代</td>
                      {FISCAL_MONTHS.map(m => {
                        const f = getMgmtFee(m)
                        return <td key={m} className="num" style={{ color: 'var(--ink-3)' }}>{f ? formatMan(f) : '—'}</td>
                      })}
                      <td className="num tot-col" style={{ color: 'var(--ink-3)' }}>{formatMan(totalMgmtFee)}</td>
                      <td className="num tot-col num-muted">{formatMan(totalMgmtFee / 12)}</td>
                    </tr>
                  )}

                  {/* Net profit (after mgmt fee) */}
                  {totalMgmtFee > 0 && (
                    <tr className="profit-row">
                      <td className={`col-label ${totalNetProfit < 0 ? 'cell-loss' : ''}`}>純利益</td>
                      {FISCAL_MONTHS.map(m => {
                        const s = getSalesAmount(m)
                        const e = getExpenseTotal(m)
                        const f = getMgmtFee(m)
                        const p = s - e - f
                        return <td key={m} className={`num ${s && p < 0 ? 'cell-loss' : ''}`}>{s ? formatMan(p) : '—'}</td>
                      })}
                      <td className={`num tot-col ${totalNetProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(totalNetProfit)}</td>
                      <td className={`num tot-col ${totalNetProfit < 0 ? 'cell-loss' : ''}`}>{formatMan(totalNetProfit / 12)}</td>
                    </tr>
                  )}

                  {/* Profit rate */}
                  <tr className="rate-row">
                    <td className="col-label">利益率</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m)
                      const e = getExpenseTotal(m)
                      const f = getMgmtFee(m)
                      const net = s - e - f
                      const r = s ? net / s : 0
                      return <td key={m} className={`num ${r < 0 ? 'cell-loss' : ''}`}>{s ? formatPercent(r) : '—'}</td>
                    })}
                    <td className="num tot-col">{totalSales ? formatPercent(totalNetProfit / totalSales) : '—'}</td>
                    <td className="num tot-col" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
