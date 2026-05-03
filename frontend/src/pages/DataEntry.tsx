import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster } from '../lib/useBeautyData'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, EXPENSE_CATEGORIES, currentFiscalYear, formatAmount, formatPercent, formatMan, calcDerivedAmount } from '../lib/types'
import type { DataType, BeautyMonthlyData, BeautyItemMaster } from '../lib/types'

type FormValues = Record<number, string>

function getPrevMonth(month: number, fiscalYear: number) {
  if (month === 4) return { month: 3, fiscalYear: fiscalYear - 1 }
  return { month: month - 1, fiscalYear }
}

export function DataEntry() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [dataType, setDataType] = useState<DataType>('実績')
  const [values, setValues] = useState<FormValues>({})
  const [existingData, setExistingData] = useState<BeautyMonthlyData[]>([])
  const [prevMonthData, setPrevMonthData] = useState<BeautyMonthlyData[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const topItems = useMemo(() =>
    items.filter(i => i.item_category === '売上').sort((a, b) => a.sort_order - b.sort_order), [items])

  const expenseGroups = useMemo(() => {
    const groups: Record<string, BeautyItemMaster[]> = {}
    for (const cat of EXPENSE_CATEGORIES) {
      groups[cat] = items.filter(i => i.item_category === cat).sort((a, b) => a.sort_order - b.sort_order)
    }
    return groups
  }, [items])

  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])
  const customersItem = useMemo(() => items.find(i => i.item_code === 'customers'), [items])
  const discountItem = useMemo(() => items.find(i => i.item_code === 'discount'), [items])

  const loadData = useCallback(async () => {
    if (!storeId || !fiscalYear) return
    setLoading(true)
    setMessage(null)
    const prev = getPrevMonth(month, fiscalYear)
    const [currentResult, prevResult] = await Promise.all([
      apiGet<BeautyMonthlyData[]>('beauty_monthly_data', { select: '*', store_id: `eq.${storeId}`, fiscal_year: `eq.${fiscalYear}`, month: `eq.${month}`, data_type: `eq.${dataType}` }),
      apiGet<BeautyMonthlyData[]>('beauty_monthly_data', { select: '*', store_id: `eq.${storeId}`, fiscal_year: `eq.${prev.fiscalYear}`, month: `eq.${prev.month}`, data_type: `eq.${dataType}` }),
    ])
    const current = currentResult.data ?? []
    const prevData = prevResult.data ?? []
    setExistingData(current)
    setPrevMonthData(prevData)
    const newValues: FormValues = {}
    for (const d of current) newValues[d.item_id] = d.amount
    const fixedItems = items.filter(i => i.item_category === '固定費')
    for (const item of fixedItems) {
      if (!newValues[item.id]) {
        const pv = prevData.find(d => d.item_id === item.id)
        if (pv) newValues[item.id] = pv.amount
      }
    }
    setValues(newValues)
    setLoading(false)
  }, [storeId, fiscalYear, month, dataType, items])

  useEffect(() => { if (items.length > 0) loadData() }, [loadData, items.length])

  const setValue = useCallback((itemId: number, val: string) => {
    setValues(prev => ({ ...prev, [itemId]: val }))
  }, [])

  const numVal = useCallback((itemId: number): number => {
    const v = values[itemId]
    return v ? (parseFloat(v) || 0) : 0
  }, [values])

  // item_code -> 数値 の lookup（派生計算用）
  const codeValues = useMemo(() => {
    const out: Record<string, number> = {}
    for (const it of items) out[it.item_code] = numVal(it.id)
    return out
  }, [items, numVal])

  const unitPrice = useMemo(() => {
    if (!salesItem || !customersItem) return 0
    const s = numVal(salesItem.id), c = numVal(customersItem.id)
    return c > 0 ? Math.round(s / c) : 0
  }, [salesItem, customersItem, numVal])

  const catTotal = useCallback((cat: string) => {
    // 派生計算項目（仕入消費税・納付税額など）はカテゴリ合計から除外して二重計上を防ぐ
    return (expenseGroups[cat] ?? [])
      .filter(i => calcDerivedAmount(i.item_code, codeValues) === null)
      .reduce((s, i) => s + numVal(i.id), 0)
  }, [expenseGroups, numVal, codeValues])

  const totalExp = useMemo(() => {
    let t = EXPENSE_CATEGORIES.reduce((s, c) => s + catTotal(c), 0)
    if (discountItem) t += numVal(discountItem.id)
    return t
  }, [catTotal, discountItem, numVal])

  const netProfit = useMemo(() => salesItem ? numVal(salesItem.id) - totalExp : 0, [salesItem, numVal, totalExp])
  const profitRate = useMemo(() => {
    if (!salesItem) return 0
    const s = numVal(salesItem.id)
    return s > 0 ? netProfit / s : 0
  }, [salesItem, numVal, netProfit])

  const copyPrevFixed = useCallback(() => {
    const newVals: FormValues = { ...values }
    for (const item of items.filter(i => i.item_category === '固定費')) {
      const pv = prevMonthData.find(d => d.item_id === item.id)
      if (pv) newVals[item.id] = pv.amount
    }
    setValues(newVals)
  }, [items, values, prevMonthData])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)
    try {
      const promises: Promise<unknown>[] = []
      for (const [idStr, amount] of Object.entries(values)) {
        const itemId = parseInt(idStr, 10)
        if (!amount && amount !== '0') continue
        const existing = existingData.find(d => d.item_id === itemId)
        if (existing) {
          promises.push(apiPatch('beauty_monthly_data', { id: `eq.${existing.id}` }, { amount: parseFloat(amount) }))
        } else {
          promises.push(apiPost('beauty_monthly_data', { store_id: storeId, fiscal_year: fiscalYear, month, data_type: dataType, item_id: itemId, amount: parseFloat(amount) }))
        }
      }
      await Promise.all(promises)
      setMessage({ type: 'success', text: '保存しました' })
      await loadData()
    } catch {
      setMessage({ type: 'error', text: '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }, [values, existingData, storeId, fiscalYear, month, dataType, loadData])

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 3000); return () => clearTimeout(t) }
  }, [message])

  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)
  const qLabel = (m: number) => [4,5,6].includes(m) ? 'Q1' : [7,8,9].includes(m) ? 'Q2' : [10,11,12].includes(m) ? 'Q3' : 'Q4'

  const changedCount = Object.keys(values).filter(k => {
    const b = existingData.find(r => r.item_id === +k)
    return b ? b.amount !== values[+k] : values[+k] !== '' && values[+k] !== undefined
  }).length

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 04 / ENTRY</span>
            <h1 className="page-title">月次入力</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · {MONTH_LABELS[month]}のデータを入力</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="seg" role="tablist">
            {(['実績', '目標', '見通し'] as DataType[]).map(dt => (
              <button key={dt} className="seg-btn" aria-pressed={dataType === dt} onClick={() => setDataType(dt)}>
                <span>{dt}</span>
                <span className="sub">{{ '実績': 'ACTUAL', '目標': 'TARGET', '見通し': 'FORECAST' }[dt]}</span>
              </button>
            ))}
          </div>
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
          {FISCAL_MONTHS.map(m => (
            <button key={m} className="month-btn" aria-pressed={month === m} onClick={() => setMonth(m)}>
              <span>{MONTH_LABELS[m]}</span><span className="q">{qLabel(m)}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div> : (
        <div className="split">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Sales card */}
            <div className="card">
              <div className="card-head">
                <div className="card-title"><span className="index">01</span>売上</div>
              </div>
              <div>
                {topItems.map((item, i) => {
                  // customers は item_master 上 is_calculated=1 だが、サロンボード自動取込
                  // および手入力対応のため入力欄を表示する（unit_price のみ自動計算）
                  const showAsInput = !item.is_calculated || item.item_code === 'customers'
                  return showAsInput ? (
                    <div key={item.id} className="entry-row" style={i === topItems.length - 1 ? { borderBottom: 'none' } : undefined}>
                      <label>{item.item_name}</label>
                      <span className="smallcaps" style={{ textAlign: 'right' }}>
                        前月 {(() => {
                          const pv = prevMonthData.find(d => d.item_id === item.id)
                          if (!pv) return '—'
                          const v = parseFloat(pv.amount)
                          return item.item_code === 'customers' ? v.toLocaleString() : formatMan(v)
                        })()}
                      </span>
                      <input type="number" value={values[item.id] ?? ''} onChange={e => setValue(item.id, e.target.value)}
                        placeholder="0" className="entry-input tnum" />
                    </div>
                  ) : (
                    <div key={item.id} className="entry-row entry-derived" style={i === topItems.length - 1 ? { borderBottom: 'none' } : undefined}>
                      <span>{item.item_name}</span>
                      <span className="smallcaps">自動計算</span>
                      <span className="tnum" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                        {item.item_code === 'unit_price' && unitPrice ? '¥' + formatAmount(unitPrice) : '—'}
                      </span>
                    </div>
                  )
                })}
                {/* Derived unit price if not in items */}
                {!topItems.find(i => i.item_code === 'unit_price') && (
                  <div className="entry-row entry-derived" style={{ borderBottom: 'none' }}>
                    <span>客単価</span>
                    <span className="smallcaps">自動計算</span>
                    <span className="tnum" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                      {unitPrice ? '¥' + formatAmount(unitPrice) : '—'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Expense category cards */}
            {EXPENSE_CATEGORIES.map((cat, idx) => {
              const catItems = expenseGroups[cat]
              if (!catItems || catItems.length === 0) return null
              const sub = catTotal(cat)
              return (
                <div className="card" key={cat}>
                  <div className="card-head">
                    <div className="card-title">
                      <span className="index">{String(idx + 2).padStart(2, '0')}</span>{cat}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {cat === '固定費' && (
                        <button className="btn btn-ghost" onClick={copyPrevFixed}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/></svg>
                          前月をコピー
                        </button>
                      )}
                      <span className="smallcaps">小計</span>
                      <span className="tnum" style={{ fontWeight: 600 }}>{formatMan(sub)}</span>
                    </div>
                  </div>
                  <div>
                    {catItems.map((item, i) => {
                      const lastStyle = i === catItems.length - 1 ? { borderBottom: 'none' } : undefined
                      // 派生項目（仕入消費税・納付税額など）は入力欄ではなく計算結果を表示
                      const derived = item.is_calculated ? calcDerivedAmount(item.item_code, codeValues) : null
                      if (derived !== null) {
                        return (
                          <div key={item.id} className="entry-row entry-derived" style={lastStyle}>
                            <span>{item.item_name}</span>
                            <span className="smallcaps">自動計算</span>
                            <span className="tnum" style={{ textAlign: 'right', color: 'var(--ink-2)' }}>
                              {derived ? '¥' + formatAmount(Math.round(derived)) : '—'}
                            </span>
                          </div>
                        )
                      }
                      return (
                        <div key={item.id} className="entry-row" style={lastStyle}>
                          <label>{item.item_name}</label>
                          <span className="smallcaps" style={{ textAlign: 'right' }}>
                            前月 {(() => {
                              const pv = prevMonthData.find(d => d.item_id === item.id)
                              return pv ? formatMan(parseFloat(pv.amount)) : '—'
                            })()}
                          </span>
                          <input type="number" value={values[item.id] ?? ''} onChange={e => setValue(item.id, e.target.value)}
                            placeholder="0" className="entry-input tnum" />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Live summary sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 76 }}>
            <div className="card">
              <div className="card-head">
                <div className="card-title"><span className="index">LIVE</span>月次サマリー</div>
                <span className="chip accent">{MONTH_LABELS[month]}</span>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div className="smallcaps" style={{ marginBottom: 2 }}>売上</div>
                  <div className="tnum" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>
                    ¥{salesItem && numVal(salesItem.id) ? formatAmount(Math.round(numVal(salesItem.id))) : <span className="num-dim">0</span>}
                  </div>
                </div>
                <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-2)' }}>
                      <span>{cat}</span>
                      <span className="tnum">{catTotal(cat) ? formatAmount(Math.round(catTotal(cat))) : '—'}</span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginTop: 4, fontWeight: 600 }}>
                    <span>支出合計</span>
                    <span className="tnum">¥{formatAmount(Math.round(totalExp))}</span>
                  </div>
                </div>
                <div style={{ borderTop: '2px solid var(--ink)', paddingTop: 12 }}>
                  <div className="smallcaps" style={{ marginBottom: 4 }}>純利益</div>
                  <div className={`tnum ${netProfit < 0 ? 'num-neg' : 'num-pos'}`} style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em' }}>
                    {netProfit < 0 ? '−¥' + formatAmount(Math.abs(Math.round(netProfit))) : '¥' + formatAmount(Math.round(netProfit))}
                  </div>
                  <div className="tnum" style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                    利益率 {salesItem && numVal(salesItem.id) ? formatPercent(profitRate) : '—'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Save bar */}
      <div className="savebar">
        <div className="summary">
          <div className="item">
            <span className="k">変更</span>
            <span className="v">{changedCount}件</span>
          </div>
          <div className="item">
            <span className="k">純利益</span>
            <span className={`v ${netProfit < 0 ? 'num-neg' : 'num-pos'}`}>
              {netProfit < 0 ? '−' : ''}¥{formatAmount(Math.abs(Math.round(netProfit)))}
            </span>
          </div>
          <div className="item">
            <span className="k">利益率</span>
            <span className="v">{salesItem && numVal(salesItem.id) ? formatPercent(profitRate) : '—'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {message && (
            <span style={{ fontSize: 12, color: message.type === 'success' ? 'var(--positive)' : 'var(--negative)' }}>
              {message.text}
            </span>
          )}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
