import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatPercent, formatMan } from '../lib/types'
import type { BeautyMonthlyData, DataType } from '../lib/types'

type CellKey = string
function cellKey(itemId: number, month: number): CellKey { return `${itemId}-${month}` }
type HelperId = 'sales' | 'labor' | 'fixed' | 'variable'

export function TargetSetting() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [dataType, setDataType] = useState<'目標' | '見通し'>('目標')

  const { data, loading, reload } = useMonthlyData(storeId, fiscalYear, dataType as DataType)

  const [editValues, setEditValues] = useState<Record<CellKey, string>>({})
  const [changedCells, setChangedCells] = useState<Set<CellKey>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Helpers state
  const [helperOpen, setHelperOpen] = useState<HelperId | null>(null)
  const [salesAnnual, setSalesAnnual] = useState('')
  const [salesDist, setSalesDist] = useState<'equal' | 'lastyear'>('equal')
  const [laborMonthly, setLaborMonthly] = useState('')
  const [transportMonthly, setTransportMonthly] = useState('')
  const [welfareRate, setWelfareRate] = useState('14.5')
  const [prevActuals, setPrevActuals] = useState<BeautyMonthlyData[]>([])
  const [loadingPrev, setLoadingPrev] = useState(false)

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
        : await apiPost('beauty_monthly_data', { store_id: storeId, fiscal_year: fiscalYear, month: mm, data_type: dataType, item_id: iid, amount })
      res.error ? errors++ : saved++
    }
    setSaving(false)
    setSaveMessage(errors > 0 ? `${saved}件保存、${errors}件エラー` : `${saved}件の${dataType}を保存しました`)
    await reload()
  }

  async function fetchPrevActuals(): Promise<BeautyMonthlyData[]> {
    if (prevActuals.length > 0) return prevActuals
    setLoadingPrev(true)
    const r = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
      select: '*', store_id: `eq.${storeId}`, fiscal_year: `eq.${fiscalYear - 1}`, data_type: 'eq.実績',
    })
    setLoadingPrev(false)
    const d = r.data ?? []
    setPrevActuals(d)
    return d
  }

  function applyToState(patches: Record<CellKey, string>) {
    setEditValues(prev => ({ ...prev, ...patches }))
    setChangedCells(prev => { const n = new Set(prev); Object.keys(patches).forEach(k => n.add(k)); return n })
    setSaveMessage(null)
  }

  async function applySalesDistribution() {
    if (!salesItem) return
    const annual = parseFloat(salesAnnual)
    if (!annual) return
    const patches: Record<CellKey, string> = {}
    if (salesDist === 'equal') {
      const monthly = Math.round(annual / 12)
      FISCAL_MONTHS.forEach(m => { patches[cellKey(salesItem.id, m)] = String(monthly) })
    } else {
      const prev = await fetchPrevActuals()
      const prevSales = prev.filter(d => d.item_id === salesItem.id)
      const prevTotal = prevSales.reduce((s, d) => s + parseFloat(d.amount), 0)
      if (prevTotal > 0) {
        FISCAL_MONTHS.forEach(m => {
          const pa = prevSales.find(d => d.month === m)
          patches[cellKey(salesItem.id, m)] = String(Math.round(annual * (pa ? parseFloat(pa.amount) : 0) / prevTotal))
        })
      }
    }
    applyToState(patches)
  }

  function applyLaborCosts() {
    const salaryVal = parseFloat(laborMonthly) || 0
    const transportVal = parseFloat(transportMonthly) || 0
    const rateVal = parseFloat(welfareRate) / 100
    const salaryItem = items.find(i => i.item_code === 'salary_total')
    const transportItem = items.find(i => i.item_code === 'transport_total')
    const welfareItem = items.find(i => i.item_code === 'legal_welfare')
    const patches: Record<CellKey, string> = {}
    FISCAL_MONTHS.forEach(m => {
      if (salaryItem && salaryVal > 0) patches[cellKey(salaryItem.id, m)] = String(salaryVal)
      if (transportItem && transportVal > 0) patches[cellKey(transportItem.id, m)] = String(transportVal)
      if (welfareItem && salaryVal > 0 && !isNaN(rateVal)) patches[cellKey(welfareItem.id, m)] = String(Math.round(salaryVal * rateVal))
    })
    applyToState(patches)
  }

  async function applyFixedCosts() {
    const prev = await fetchPrevActuals()
    const fixedItems = items.filter(i => i.item_category === '固定費')
    const patches: Record<CellKey, string> = {}
    for (const item of fixedItems) {
      for (const m of FISCAL_MONTHS) {
        const pd = prev.find(d => d.item_id === item.id && d.month === m)
        if (pd && parseFloat(pd.amount) !== 0) patches[cellKey(item.id, m)] = String(parseFloat(pd.amount))
      }
    }
    applyToState(patches)
  }

  async function applyVariableRatios() {
    if (!salesItem) return
    const prev = await fetchPrevActuals()
    const variableItems = items.filter(i => ['仕入', 'その他'].includes(i.item_category) && !i.is_calculated && i.item_code !== 'twinkle_fee')
    const patches: Record<CellKey, string> = {}
    for (const item of variableItems) {
      for (const m of FISCAL_MONTHS) {
        const prevExp = prev.find(d => d.item_id === item.id && d.month === m)
        const prevSales = prev.find(d => d.item_id === salesItem.id && d.month === m)
        if (!prevExp || !prevSales) continue
        const prevSalesAmt = parseFloat(prevSales.amount)
        if (prevSalesAmt === 0) continue
        const ratio = parseFloat(prevExp.amount) / prevSalesAmt
        if (!isNaN(ratio) && isFinite(ratio)) {
          const currSales = getCellValue(salesItem.id, m)
          if (currSales > 0) patches[cellKey(item.id, m)] = String(Math.round(currSales * ratio))
        }
      }
    }
    applyToState(patches)
  }

  const totalSales = FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m), 0)
  const totalExp = FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)
  const totalProfit = totalSales - totalExp
  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  const HELPERS: { id: HelperId; label: string; sub: string }[] = [
    { id: 'sales', label: '① 売上配分', sub: '年額→月次展開' },
    { id: 'labor', label: '② 人件費', sub: '月額×法定福利' },
    { id: 'fixed', label: '③ 固定費', sub: '前年実績コピー' },
    { id: 'variable', label: '④ 変動費', sub: '前年比率適用' },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 05 / TARGETS</span>
            <h1 className="page-title">目標・見通し設定</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · {dataType}値を編集</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || changedCells.size === 0}>
            {saving ? '保存中...' : `保存${changedCells.size > 0 ? ` (${changedCells.size})` : ''}`}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => { setStoreId(Number(e.target.value)); setChangedCells(new Set()); setSaveMessage(null); setPrevActuals([]) }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => { setFiscalYear(Number(e.target.value)); setChangedCells(new Set()); setSaveMessage(null); setPrevActuals([]) }}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
        <div className="seg" role="tablist">
          {(['目標', '見通し'] as const).map(dt => (
            <button key={dt} className="seg-btn" aria-pressed={dataType === dt}
              onClick={() => { setDataType(dt); setChangedCells(new Set()); setSaveMessage(null) }}>
              <span>{dt}</span>
              <span className="sub">{dt === '目標' ? 'TARGET' : 'FORECAST'}</span>
            </button>
          ))}
        </div>
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
              <div className="kpi-label">{dataType}売上</div>
              <div className="kpi-value">{formatMan(totalSales)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalSales / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{dataType}支出</div>
              <div className="kpi-value">{formatMan(totalExp)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalExp / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{dataType}利益</div>
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

          {/* Helper panel */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="helper-bar">
              <span className="smallcaps" style={{ color: 'var(--ink-4)', paddingRight: 8 }}>HELPERS</span>
              {HELPERS.map(h => (
                <button key={h.id} className={`helper-btn${helperOpen === h.id ? ' active' : ''}`}
                  onClick={() => setHelperOpen(ho => ho === h.id ? null : h.id)}>
                  <span>{h.label}</span>
                  <span className="helper-btn-sub">{h.sub}</span>
                </button>
              ))}
              {loadingPrev && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>前年データ読込中…</span>}
            </div>

            {helperOpen === 'sales' && (
              <div className="helper-body">
                <div className="helper-field">
                  <label className="helper-label">年間売上目標</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" className="helper-input" value={salesAnnual}
                      onChange={e => setSalesAnnual(e.target.value)} placeholder="例: 20000000" />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                  </div>
                </div>
                <div className="helper-field">
                  <label className="helper-label">配分方法</label>
                  <div className="seg">
                    <button className="seg-btn" aria-pressed={salesDist === 'equal'} onClick={() => setSalesDist('equal')}>均等配分</button>
                    <button className="seg-btn" aria-pressed={salesDist === 'lastyear'} onClick={() => setSalesDist('lastyear')}>前年実績比率</button>
                  </div>
                </div>
                <div className="helper-field" style={{ justifyContent: 'flex-end' }}>
                  <label className="helper-label">&nbsp;</label>
                  <button className="btn btn-primary" onClick={applySalesDistribution} disabled={!salesAnnual || loadingPrev}>
                    売上に適用
                  </button>
                </div>
              </div>
            )}

            {helperOpen === 'labor' && (
              <div className="helper-body">
                <div className="helper-field">
                  <label className="helper-label">月額人件費合計</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" className="helper-input" value={laborMonthly}
                      onChange={e => setLaborMonthly(e.target.value)} placeholder="例: 800000" />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                  </div>
                </div>
                <div className="helper-field">
                  <label className="helper-label">月額交通費合計</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" className="helper-input" value={transportMonthly}
                      onChange={e => setTransportMonthly(e.target.value)} placeholder="例: 30000" />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                  </div>
                </div>
                <div className="helper-field">
                  <label className="helper-label">法定福利率（法定福利費に適用）</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" className="helper-input" style={{ width: 80 }} value={welfareRate}
                      onChange={e => setWelfareRate(e.target.value)} step="0.1" />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>%</span>
                  </div>
                </div>
                <div className="helper-field" style={{ justifyContent: 'flex-end' }}>
                  <label className="helper-label">&nbsp;</label>
                  <button className="btn btn-primary" onClick={applyLaborCosts} disabled={!laborMonthly}>
                    人件費・法定福利に適用
                  </button>
                </div>
              </div>
            )}

            {helperOpen === 'fixed' && (
              <div className="helper-body">
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  {fiscalYear - 1}年度の実績から固定費をそのままコピーします。<br />
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>対象: 家賃・商店街費・HPB・加盟費・水道等の固定費科目</span>
                </div>
                <button className="btn btn-primary" onClick={applyFixedCosts} disabled={loadingPrev}>
                  {loadingPrev ? '読込中...' : `${fiscalYear - 1}年度実績からコピー`}
                </button>
              </div>
            )}

            {helperOpen === 'variable' && (
              <div className="helper-body">
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  {fiscalYear - 1}年度の「費用 ÷ 売上」比率 × 今年の目標売上で各月の変動費を自動計算します。<br />
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>対象: 仕入・その他 ／ ①売上配分を先に適用してから実行してください</span>
                </div>
                <button className="btn btn-primary" onClick={applyVariableRatios} disabled={loadingPrev || totalSales === 0}>
                  {loadingPrev ? '読込中...' : '前年比率を適用'}
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-head">
              <div className="card-title"><span className="index">GRID</span>{dataType}入力 · 全科目 × 全月</div>
              <span className="smallcaps">単位: 円 · TABでセル移動</span>
            </div>
            <div className="table-scroll">
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
                  <tr className={`profit-row${totalProfit < 0 ? ' loss' : ''}`}>
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
