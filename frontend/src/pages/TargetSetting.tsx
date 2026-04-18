import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatPercent, formatMan } from '../lib/types'
import type { BeautyMonthlyData } from '../lib/types'

type CellKey = string
function cellKey(itemId: number, month: number): CellKey { return `${itemId}-${month}` }

export function TargetSetting() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())

  const { data, loading, reload } = useMonthlyData(storeId, fiscalYear, '目標')

  const [editValues, setEditValues] = useState<Record<CellKey, string>>({})
  const [changedCells, setChangedCells] = useState<Set<CellKey>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)

  const dataLookup = useMemo(() => {
    const map: Record<CellKey, BeautyMonthlyData> = {}
    for (const d of data) map[cellKey(d.item_id, d.month)] = d
    return map
  }, [data])

  const initializeFromData = useCallback((records: BeautyMonthlyData[]) => {
    const vals: Record<CellKey, string> = {}
    for (const d of records) {
      const amount = parseFloat(d.amount)
      if (amount !== 0) vals[cellKey(d.item_id, d.month)] = String(amount)
    }
    setEditValues(vals)
    setChangedCells(new Set())
    setSaveMessage(null)
  }, [])

  useEffect(() => {
    if (data.length > 0) initializeFromData(data)
    else if (!loading) { setEditValues({}); setChangedCells(new Set()) }
  }, [data, loading, initializeFromData])

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated).sort((a, b) => a.sort_order - b.sort_order), [items])
  const salesItems = useMemo(() => displayItems.filter(i => i.item_category === '売上'), [displayItems])
  const expenseItems = useMemo(() => displayItems.filter(i => i.item_category !== '売上'), [displayItems])
  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])

  function getCellValue(itemId: number, month: number): number {
    const v = editValues[cellKey(itemId, month)]
    return v !== undefined && v !== '' ? (parseFloat(v) || 0) : 0
  }
  function getRowTotal(itemId: number): number {
    return FISCAL_MONTHS.reduce((s, m) => s + getCellValue(itemId, m), 0)
  }
  function getExpenseTotal(month: number): number {
    return expenseItems.reduce((s, i) => s + getCellValue(i.id, month), 0)
  }
  function getSalesAmount(month: number): number {
    return salesItem ? getCellValue(salesItem.id, month) : 0
  }

  function handleCellChange(itemId: number, month: number, value: string) {
    const key = cellKey(itemId, month)
    if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
    setEditValues(prev => ({ ...prev, [key]: value }))
    const original = dataLookup[key]
    const originalAmount = original ? String(parseFloat(original.amount)) : ''
    const isChanged = value !== originalAmount && !(value === '' && (originalAmount === '' || originalAmount === '0'))
    setChangedCells(prev => {
      const next = new Set(prev)
      isChanged ? next.add(key) : next.delete(key)
      return next
    })
    setSaveMessage(null)
  }

  async function handleSave() {
    if (changedCells.size === 0) return
    setSaving(true); setSaveMessage(null)
    let saved = 0, errors = 0
    for (const key of changedCells) {
      const [iid, mm] = key.split('-').map(Number)
      const amount = parseFloat(editValues[key] || '0') || 0
      const existing = dataLookup[key]
      const res = existing
        ? await apiPatch('beauty_monthly_data', { id: `eq.${existing.id}` }, { amount })
        : await apiPost('beauty_monthly_data', { store_id: storeId, fiscal_year: fiscalYear, month: mm, data_type: '目標', item_id: iid, amount })
      res.error ? errors++ : saved++
    }
    setSaving(false)
    setSaveMessage(errors > 0 ? `${saved}件保存、${errors}件エラー` : `${saved}件の目標を保存しました`)
    await reload()
  }

  async function handleCopyPreviousYear() {
    setCopying(true)
    const res = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
      select: '*', store_id: `eq.${storeId}`, fiscal_year: `eq.${fiscalYear - 1}`, data_type: 'eq.目標',
    })
    setCopying(false)
    if (!res.data || res.data.length === 0) {
      setSaveMessage(`${fiscalYear - 1}年度の目標データが見つかりません`); return
    }
    const newVals: Record<CellKey, string> = {}
    const newChanged = new Set<CellKey>()
    for (const d of res.data) {
      const key = cellKey(d.item_id, d.month)
      const amount = parseFloat(d.amount)
      if (amount !== 0) {
        newVals[key] = String(amount)
        const existing = dataLookup[key]
        if (!existing || String(parseFloat(existing.amount)) !== String(amount)) newChanged.add(key)
      }
    }
    setEditValues(newVals)
    setChangedCells(newChanged)
    setSaveMessage(`${fiscalYear - 1}年度の目標を${res.data.length}件コピーしました（未保存）`)
  }

  const totalSales = FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m), 0)
  const totalExp = FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)
  const totalProfit = totalSales - totalExp
  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 05 / TARGETS</span>
            <h1 className="page-title">年間目標設定</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · 目標値を編集</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn" onClick={handleCopyPreviousYear} disabled={copying}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8a5 5 0 0 1 9-3.2M13 8a5 5 0 0 1-9 3.2"/><path d="M12 2v3h-3M4 14v-3h3"/></svg>
            {copying ? 'コピー中...' : '前年度をコピー'}
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || changedCells.size === 0}>
            {saving ? '保存中...' : `保存${changedCells.size > 0 ? ` (${changedCells.size})` : ''}`}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => { setStoreId(Number(e.target.value)); setChangedCells(new Set()); setSaveMessage(null) }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => { setFiscalYear(Number(e.target.value)); setChangedCells(new Set()); setSaveMessage(null) }}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
        {saveMessage && (
          <span style={{ fontSize: 12, color: saveMessage.includes('エラー') ? 'var(--negative)' : 'var(--positive)' }}>
            {saveMessage}
          </span>
        )}
      </div>

      {loading ? <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div> : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">目標売上</div>
              <div className="kpi-value">{formatMan(totalSales)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalSales / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">目標支出</div>
              <div className="kpi-value">{formatMan(totalExp)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalExp / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">目標利益</div>
              <div className="kpi-value">{formatMan(totalProfit)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>{totalSales ? `利益率 ${formatPercent(totalProfit / totalSales)}` : ''}</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">編集中</div>
              <div className="kpi-value">{changedCells.size}<span className="unit">件</span></div>
              <div className="kpi-meta">
                {changedCells.size > 0 && <span className="chip accent">UNSAVED</span>}
                <span>{changedCells.size ? '未保存の変更' : '変更なし'}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="card-head">
              <div className="card-title"><span className="index">GRID</span>目標入力 · 全科目 × 全月</div>
              <span className="smallcaps">単位: 円 · TABでセル移動</span>
            </div>
            <div style={{ overflowX: 'auto', overflowY: 'clip' }}>
              <table className="ltable">
                <thead>
                  <tr>
                    <th className="col-label">科目</th>
                    {FISCAL_MONTHS.map(m => <th key={m}>{MONTH_LABELS[m]}</th>)}
                    <th className="tot-col">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {[...salesItems, ...expenseItems].map(item => {
                    const total = getRowTotal(item.id)
                    const isPrimary = item.item_code === 'sales'
                    return (
                      <tr key={item.id} className={isPrimary ? 'emphasis' : ''}>
                        <td className="col-label">{item.item_name}</td>
                        {FISCAL_MONTHS.map(m => {
                          const key = cellKey(item.id, m)
                          const isChanged = changedCells.has(key)
                          return (
                            <td key={m} className={`num ${isChanged ? 'cell-changed' : ''}`} style={{ padding: 0 }}>
                              <input className="cell-input" value={editValues[key] ?? ''}
                                onChange={e => handleCellChange(item.id, m, e.target.value)} placeholder="—" />
                            </td>
                          )
                        })}
                        <td className="num tot-col">{total ? formatMan(total) : '—'}</td>
                      </tr>
                    )
                  })}

                  <tr className="total-row">
                    <td className="col-label">支出合計</td>
                    {FISCAL_MONTHS.map(m => <td key={m} className="num">{getExpenseTotal(m) ? formatMan(getExpenseTotal(m)) : '—'}</td>)}
                    <td className="num tot-col">{formatMan(totalExp)}</td>
                  </tr>
                  <tr className={`profit-row ${totalProfit < 0 ? 'loss' : ''}`}>
                    <td className="col-label">純利益</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m), e = getExpenseTotal(m)
                      return <td key={m} className="num">{s ? formatMan(s - e) : '—'}</td>
                    })}
                    <td className="num tot-col">{formatMan(totalProfit)}</td>
                  </tr>
                  <tr className="rate-row">
                    <td className="col-label">利益率</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m), e = getExpenseTotal(m)
                      return <td key={m} className="num">{s ? formatPercent((s - e) / s) : '—'}</td>
                    })}
                    <td className="num tot-col">{totalSales ? formatPercent(totalProfit / totalSales) : '—'}</td>
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
