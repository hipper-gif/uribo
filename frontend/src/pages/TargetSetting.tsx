import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { StoreYearSelector } from '../components/StoreYearSelector'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatAmount, formatPercent } from '../lib/types'
import type { BeautyMonthlyData } from '../lib/types'

// Cell key: "itemId-month"
type CellKey = string
function cellKey(itemId: number, month: number): CellKey {
  return `${itemId}-${month}`
}

export function TargetSetting() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())

  const { data, loading, reload } = useMonthlyData(storeId, fiscalYear, '目標')

  // Editable values: cellKey -> string (user input)
  const [editValues, setEditValues] = useState<Record<CellKey, string>>({})
  // Track which cells have been changed from their original
  const [changedCells, setChangedCells] = useState<Set<CellKey>>(new Set())
  // Saving state
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  // Copy previous year state
  const [copying, setCopying] = useState(false)

  // Lookup: cellKey -> BeautyMonthlyData record (for detecting existing vs new)
  const dataLookup = useMemo(() => {
    const map: Record<CellKey, BeautyMonthlyData> = {}
    for (const d of data) {
      map[cellKey(d.item_id, d.month)] = d
    }
    return map
  }, [data])

  // Initialize edit values from loaded data
  const initializeFromData = useCallback((records: BeautyMonthlyData[]) => {
    const vals: Record<CellKey, string> = {}
    for (const d of records) {
      const amount = parseFloat(d.amount)
      if (amount !== 0) {
        vals[cellKey(d.item_id, d.month)] = String(amount)
      }
    }
    setEditValues(vals)
    setChangedCells(new Set())
    setSaveMessage(null)
  }, [])

  // Re-initialize when data changes (on load / after reload)
  useEffect(() => {
    if (data.length > 0) {
      initializeFromData(data)
    } else if (!loading) {
      setEditValues({})
      setChangedCells(new Set())
    }
  }, [data, loading, initializeFromData])

  // Display items: non-calculated, sorted
  const displayItems = useMemo(() => {
    return items.filter(i => !i.is_calculated).sort((a, b) => a.sort_order - b.sort_order)
  }, [items])

  // Sales item for calculated rows
  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])

  // Get cell value as number
  function getCellValue(itemId: number, month: number): number {
    const key = cellKey(itemId, month)
    const val = editValues[key]
    if (val !== undefined && val !== '') return parseFloat(val) || 0
    return 0
  }

  // Get row total
  function getRowTotal(itemId: number): number {
    return FISCAL_MONTHS.reduce((sum, m) => sum + getCellValue(itemId, m), 0)
  }

  // Get expense total for a month
  function getExpenseTotal(month: number): number {
    const expenseCategories = ['仕入', '人件費', '法定福利', '固定費', '税金', 'その他']
    return displayItems
      .filter(i => expenseCategories.includes(i.item_category))
      .reduce((sum, i) => sum + getCellValue(i.id, month), 0)
  }

  function getSalesAmount(month: number): number {
    return salesItem ? getCellValue(salesItem.id, month) : 0
  }

  // Handle cell input change
  function handleCellChange(itemId: number, month: number, value: string) {
    const key = cellKey(itemId, month)
    // Allow empty, digits, minus, dot
    if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return

    setEditValues(prev => ({ ...prev, [key]: value }))

    // Check if changed from original
    const original = dataLookup[key]
    const originalAmount = original ? String(parseFloat(original.amount)) : ''
    const isChanged = value !== originalAmount && !(value === '' && (originalAmount === '' || originalAmount === '0'))
    setChangedCells(prev => {
      const next = new Set(prev)
      if (isChanged) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
    setSaveMessage(null)
  }

  // Save all changed cells
  async function handleSave() {
    if (changedCells.size === 0) return
    setSaving(true)
    setSaveMessage(null)
    let savedCount = 0
    let errorCount = 0

    for (const key of changedCells) {
      const [itemIdStr, monthStr] = key.split('-')
      const itemId = parseInt(itemIdStr)
      const month = parseInt(monthStr)
      const amount = parseFloat(editValues[key] || '0') || 0
      const existing = dataLookup[key]

      if (existing) {
        const res = await apiPatch('beauty_monthly_data', { id: `eq.${existing.id}` }, { amount })
        if (res.error) errorCount++
        else savedCount++
      } else {
        const res = await apiPost('beauty_monthly_data', {
          store_id: storeId,
          fiscal_year: fiscalYear,
          month,
          data_type: '目標',
          item_id: itemId,
          amount,
        })
        if (res.error) errorCount++
        else savedCount++
      }
    }

    setSaving(false)
    if (errorCount > 0) {
      setSaveMessage(`${savedCount}件保存、${errorCount}件エラー`)
    } else {
      setSaveMessage(`${savedCount}件の目標を保存しました`)
    }

    // Reload data to refresh IDs and state
    await reload()
  }

  // Copy previous year's targets
  async function handleCopyPreviousYear() {
    setCopying(true)
    const prevYear = fiscalYear - 1
    const res = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
      select: '*',
      store_id: `eq.${storeId}`,
      fiscal_year: `eq.${prevYear}`,
      data_type: 'eq.目標',
    })
    setCopying(false)

    if (!res.data || res.data.length === 0) {
      setSaveMessage(`${prevYear}年度の目標データが見つかりません`)
      return
    }

    // Fill in values from previous year
    const newValues: Record<CellKey, string> = {}
    const newChanged = new Set<CellKey>()
    for (const d of res.data) {
      const key = cellKey(d.item_id, d.month)
      const amount = parseFloat(d.amount)
      if (amount !== 0) {
        newValues[key] = String(amount)
        // Mark as changed if different from current data
        const existing = dataLookup[key]
        const originalAmount = existing ? String(parseFloat(existing.amount)) : ''
        if (String(amount) !== originalAmount) {
          newChanged.add(key)
        }
      }
    }

    setEditValues(newValues)
    setChangedCells(newChanged)
    setSaveMessage(`${prevYear}年度の目標を${res.data.length}件コピーしました（未保存）`)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">年間目標設定</h2>
      <StoreYearSelector
        stores={stores}
        storeId={storeId}
        fiscalYear={fiscalYear}
        onStoreChange={(id) => { setStoreId(id); setChangedCells(new Set()); setSaveMessage(null) }}
        onYearChange={(y) => { setFiscalYear(y); setChangedCells(new Set()); setSaveMessage(null) }}
      />

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <button
          onClick={handleSave}
          disabled={saving || changedCells.size === 0}
          className={`px-4 py-2.5 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
            changedCells.size > 0
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
          }`}
        >
          {saving ? '保存中...' : `保存${changedCells.size > 0 ? `（${changedCells.size}件）` : ''}`}
        </button>
        <button
          onClick={handleCopyPreviousYear}
          disabled={copying}
          className="px-4 py-2.5 min-h-[44px] rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
        >
          {copying ? 'コピー中...' : '前年度の目標をコピー'}
        </button>
        {saveMessage && (
          <span className={`text-sm ${saveMessage.includes('エラー') ? 'text-red-600' : 'text-green-600'}`}>
            {saveMessage}
          </span>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500 py-8 text-center">読み込み中...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="sticky left-0 z-10 bg-gray-100 px-2 py-2 text-left font-medium text-gray-700 border border-gray-200 min-w-[120px]">
                  科目
                </th>
                {FISCAL_MONTHS.map(m => (
                  <th key={m} className="px-2 py-2 text-right font-medium text-gray-700 border border-gray-200 min-w-[80px]">
                    {MONTH_LABELS[m]}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium text-gray-700 border border-gray-200 min-w-[90px] bg-gray-200">
                  合計
                </th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map(item => {
                const total = getRowTotal(item.id)
                const isSales = item.item_code === 'sales'
                return (
                  <tr key={item.id} className={`${isSales ? 'bg-blue-50' : ''} hover:bg-gray-50`}>
                    <td className={`sticky left-0 z-10 px-2 py-1 border border-gray-200 text-gray-800 font-medium ${isSales ? 'bg-blue-50' : 'bg-white'}`}>
                      {item.item_name}
                    </td>
                    {FISCAL_MONTHS.map(m => {
                      const key = cellKey(item.id, m)
                      const isChanged = changedCells.has(key)
                      return (
                        <td key={m} className={`px-0.5 py-0.5 border border-gray-200 ${isChanged ? 'bg-yellow-50' : ''}`}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editValues[key] ?? ''}
                            onChange={e => handleCellChange(item.id, m, e.target.value)}
                            className={`w-full px-1.5 py-1 text-right text-xs tabular-nums border-0 outline-none focus:ring-1 focus:ring-blue-400 rounded ${
                              isChanged ? 'bg-yellow-50' : 'bg-transparent'
                            }`}
                            placeholder="-"
                          />
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right border border-gray-200 bg-gray-50 font-semibold tabular-nums">
                      {total ? formatAmount(Math.round(total)) : '-'}
                    </td>
                  </tr>
                )
              })}

              {/* 支出合計行 */}
              <tr className="bg-yellow-50 font-semibold border-t-2 border-gray-400">
                <td className="sticky left-0 z-10 bg-yellow-50 px-2 py-1.5 border border-gray-200">支出合計</td>
                {FISCAL_MONTHS.map(m => (
                  <td key={m} className="px-2 py-1.5 text-right border border-gray-200 tabular-nums">
                    {formatAmount(Math.round(getExpenseTotal(m)))}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-yellow-100 tabular-nums">
                  {formatAmount(Math.round(FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)))}
                </td>
              </tr>

              {/* 純利益行 */}
              <tr className="bg-green-50 font-semibold">
                <td className="sticky left-0 z-10 bg-green-50 px-2 py-1.5 border border-gray-200">純利益</td>
                {FISCAL_MONTHS.map(m => {
                  const profit = getSalesAmount(m) - getExpenseTotal(m)
                  return (
                    <td key={m} className={`px-2 py-1.5 text-right border border-gray-200 tabular-nums ${profit < 0 ? 'text-red-600' : ''}`}>
                      {getSalesAmount(m) ? formatAmount(Math.round(profit)) : '-'}
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums">
                  {formatAmount(Math.round(FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m) - getExpenseTotal(m), 0)))}
                </td>
              </tr>

              {/* 利益率行 */}
              <tr className="bg-green-50">
                <td className="sticky left-0 z-10 bg-green-50 px-2 py-1.5 border border-gray-200 font-medium">利益率</td>
                {FISCAL_MONTHS.map(m => {
                  const sales = getSalesAmount(m)
                  const profit = sales - getExpenseTotal(m)
                  const rate = sales ? profit / sales : 0
                  return (
                    <td key={m} className={`px-2 py-1.5 text-right border border-gray-200 tabular-nums ${rate < 0 ? 'text-red-600' : ''}`}>
                      {sales ? formatPercent(rate) : '-'}
                    </td>
                  )
                })}
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums">
                  {(() => {
                    const totalSales = FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m), 0)
                    const totalExp = FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)
                    return totalSales ? formatPercent((totalSales - totalExp) / totalSales) : '-'
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile floating save bar */}
      {changedCells.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 lg:hidden bg-white border-t border-gray-200 px-4 py-2 z-40 shadow-[0_-2px_8px_rgba(0,0,0,0.1)]">
          <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
            <span className="text-sm text-gray-600">{changedCells.size}件の変更</span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 min-h-[44px] bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors text-sm shrink-0"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
          {saveMessage && (
            <div className={`mt-1 text-xs text-center ${saveMessage.includes('エラー') ? 'text-red-600' : 'text-green-600'}`}>
              {saveMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
