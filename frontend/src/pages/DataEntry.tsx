import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster } from '../lib/useBeautyData'
import { StoreYearSelector } from '../components/StoreYearSelector'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatAmount, formatPercent } from '../lib/types'
import type { DataType, BeautyMonthlyData, BeautyItemMaster, ItemCategory } from '../lib/types'

const EXPENSE_CATEGORIES: ItemCategory[] = ['仕入', '人件費', '法定福利', '固定費', '税金', 'その他']
const CATEGORY_LABELS: Record<ItemCategory, string> = {
  '売上': '売上',
  '仕入': '仕入',
  '人件費': '人件費',
  '法定福利': '法定福利',
  '固定費': '固定費',
  '税金': '税金',
  'その他': 'その他',
}

type FormValues = Record<number, string>

function getPrevMonth(month: number): { month: number; fiscalYear: number; currentFiscalYear: number } {
  // In fiscal year terms: 4,5,6,...,12,1,2,3
  // Previous of 4 (April) is 3 (March) which belongs to the previous fiscal year
  const currentFY = currentFiscalYear()
  if (month === 4) {
    return { month: 3, fiscalYear: currentFY - 1, currentFiscalYear: currentFY }
  }
  // month 1 (Jan) prev is 12 (Dec) — same fiscal year
  // month 5 prev is 4 — same fiscal year
  return { month: month - 1, fiscalYear: currentFY, currentFiscalYear: currentFY }
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

  // Group items by category
  const topItems = useMemo(() =>
    items.filter(i => i.item_category === '売上').sort((a, b) => a.sort_order - b.sort_order), [items])

  const expenseGroups = useMemo(() => {
    const groups: Record<string, BeautyItemMaster[]> = {}
    for (const cat of EXPENSE_CATEGORIES) {
      groups[cat] = items
        .filter(i => i.item_category === cat)
        .sort((a, b) => a.sort_order - b.sort_order)
    }
    return groups
  }, [items])

  // Find special items
  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])
  const customersItem = useMemo(() => items.find(i => i.item_code === 'customers'), [items])
  const discountItem = useMemo(() => items.find(i => i.item_code === 'discount'), [items])

  // Load data for selected month
  const loadData = useCallback(async () => {
    if (!storeId || !fiscalYear) return
    setLoading(true)
    setMessage(null)

    const [currentResult, prevResult] = await Promise.all([
      apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
        select: '*',
        store_id: `eq.${storeId}`,
        fiscal_year: `eq.${fiscalYear}`,
        month: `eq.${month}`,
        data_type: `eq.${dataType}`,
      }),
      (() => {
        const prev = getPrevMonth(month)
        return apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
          select: '*',
          store_id: `eq.${storeId}`,
          fiscal_year: `eq.${prev.fiscalYear}`,
          month: `eq.${prev.month}`,
          data_type: `eq.${dataType}`,
        })
      })(),
    ])

    const current = currentResult.data ?? []
    const prev = prevResult.data ?? []

    setExistingData(current)
    setPrevMonthData(prev)

    // Build form values from existing data
    const newValues: FormValues = {}
    for (const d of current) {
      newValues[d.item_id] = d.amount
    }

    // For 固定費 items with no existing value, pre-fill from previous month
    const fixedItems = items.filter(i => i.item_category === '固定費')
    for (const item of fixedItems) {
      if (!newValues[item.id]) {
        const prevVal = prev.find(d => d.item_id === item.id)
        if (prevVal) {
          newValues[item.id] = prevVal.amount
        }
      }
    }

    setValues(newValues)
    setLoading(false)
  }, [storeId, fiscalYear, month, dataType, items])

  useEffect(() => {
    if (items.length > 0) loadData()
  }, [loadData, items.length])

  // Update a single value
  const setValue = useCallback((itemId: number, val: string) => {
    setValues(prev => ({ ...prev, [itemId]: val }))
  }, [])

  // Get numeric value for an item
  const getNumericValue = useCallback((itemId: number): number => {
    const v = values[itemId]
    if (!v) return 0
    return parseFloat(v) || 0
  }, [values])

  // Auto-calculated: unit price = sales / customers
  const unitPrice = useMemo(() => {
    if (!salesItem || !customersItem) return 0
    const sales = getNumericValue(salesItem.id)
    const customers = getNumericValue(customersItem.id)
    return customers > 0 ? Math.round(sales / customers) : 0
  }, [salesItem, customersItem, getNumericValue])

  // Expense total
  const expenseTotal = useMemo(() => {
    let total = 0
    for (const cat of EXPENSE_CATEGORIES) {
      const catItems = expenseGroups[cat] ?? []
      for (const item of catItems) {
        total += getNumericValue(item.id)
      }
    }
    // Also add discount
    if (discountItem) total += getNumericValue(discountItem.id)
    return total
  }, [expenseGroups, discountItem, getNumericValue])

  // Net profit
  const netProfit = useMemo(() => {
    if (!salesItem) return 0
    return getNumericValue(salesItem.id) - expenseTotal
  }, [salesItem, getNumericValue, expenseTotal])

  // Profit rate
  const profitRate = useMemo(() => {
    if (!salesItem) return 0
    const sales = getNumericValue(salesItem.id)
    return sales > 0 ? netProfit / sales : 0
  }, [salesItem, getNumericValue, netProfit])

  // Category subtotal
  const getCategoryTotal = useCallback((cat: string): number => {
    const catItems = expenseGroups[cat] ?? []
    return catItems.reduce((sum, item) => sum + getNumericValue(item.id), 0)
  }, [expenseGroups, getNumericValue])

  // Copy previous month fixed costs
  const copyPrevFixedCosts = useCallback(() => {
    const fixedItems = items.filter(i => i.item_category === '固定費')
    const newValues: FormValues = { ...values }
    for (const item of fixedItems) {
      const prevVal = prevMonthData.find(d => d.item_id === item.id)
      if (prevVal) {
        newValues[item.id] = prevVal.amount
      }
    }
    setValues(newValues)
  }, [items, values, prevMonthData])

  // Save all values
  const handleSave = useCallback(async () => {
    setSaving(true)
    setMessage(null)

    try {
      const promises: Promise<unknown>[] = []

      for (const [itemIdStr, amount] of Object.entries(values)) {
        const itemId = parseInt(itemIdStr, 10)
        if (!amount && amount !== '0') continue

        const existing = existingData.find(d => d.item_id === itemId)
        if (existing) {
          // PATCH existing record
          promises.push(
            apiPatch('beauty_monthly_data', { id: `eq.${existing.id}` }, { amount: parseFloat(amount) })
          )
        } else {
          // POST new record
          promises.push(
            apiPost('beauty_monthly_data', {
              store_id: storeId,
              fiscal_year: fiscalYear,
              month,
              data_type: dataType,
              item_id: itemId,
              amount: parseFloat(amount),
            })
          )
        }
      }

      await Promise.all(promises)
      setMessage({ type: 'success', text: '保存しました' })
      // Reload to get fresh IDs for newly created records
      await loadData()
    } catch {
      setMessage({ type: 'error', text: '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }, [values, existingData, storeId, fiscalYear, month, dataType, loadData])

  // Clear message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [message])

  // Render an input field for an item
  const renderInput = (item: BeautyItemMaster, bgClass = '') => {
    if (item.is_calculated) {
      // Read-only calculated value (e.g., unit price)
      let displayVal = 0
      if (item.item_code === 'unit_price') displayVal = unitPrice
      return (
        <div key={item.id} className={`flex items-center justify-between py-1.5 px-2 ${bgClass}`}>
          <span className="text-sm text-gray-700">{item.item_name}</span>
          <span className="text-sm font-medium tabular-nums text-gray-500 w-28 text-right">
            {displayVal ? formatAmount(displayVal) : '-'}
          </span>
        </div>
      )
    }

    return (
      <div key={item.id} className={`flex items-center justify-between py-1.5 px-2 ${bgClass}`}>
        <label htmlFor={`item-${item.id}`} className="text-sm text-gray-700 shrink-0">
          {item.item_name}
        </label>
        <input
          id={`item-${item.id}`}
          type="number"
          value={values[item.id] ?? ''}
          onChange={e => setValue(item.id, e.target.value)}
          placeholder="0"
          className="w-28 px-2 py-1 text-sm text-right tabular-nums border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">月次入力</h2>

      {/* Store / Year / DataType selector */}
      <StoreYearSelector
        stores={stores}
        storeId={storeId}
        fiscalYear={fiscalYear}
        dataType={dataType}
        onStoreChange={setStoreId}
        onYearChange={setFiscalYear}
        onDataTypeChange={setDataType}
        showDataType
      />

      {/* Month selector */}
      <div className="flex flex-wrap gap-1 mb-4">
        {FISCAL_MONTHS.map(m => (
          <button key={m} onClick={() => setMonth(m)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              month === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>{MONTH_LABELS[m]}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-500 py-8 text-center">読み込み中...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column: Inputs */}
          <div className="lg:col-span-2 space-y-4">
            {/* Section 1: 売上/客数/割引 */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-blue-50 px-3 py-2 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-blue-800">売上</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {topItems.map(item => renderInput(item, ''))}
              </div>
            </div>

            {/* Section 2: Expense items by category */}
            {EXPENSE_CATEGORIES.map(cat => {
              const catItems = expenseGroups[cat]
              if (!catItems || catItems.length === 0) return null
              const isFixed = cat === '固定費'

              return (
                <div key={cat} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className={`px-3 py-2 border-b border-gray-200 flex items-center justify-between ${isFixed ? 'bg-gray-100' : 'bg-white'}`}>
                    <h3 className="text-sm font-semibold text-gray-700">{CATEGORY_LABELS[cat]}</h3>
                    <div className="flex items-center gap-3">
                      {isFixed && (
                        <button
                          onClick={copyPrevFixedCosts}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          前月の値をコピー
                        </button>
                      )}
                      <span className="text-xs text-gray-500 tabular-nums">
                        小計: {formatAmount(Math.round(getCategoryTotal(cat)))}
                      </span>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {catItems.map(item => renderInput(item, isFixed ? 'bg-gray-50' : ''))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right column: Summary */}
          <div className="space-y-4">
            {/* Summary card */}
            <div className="bg-green-50 border border-green-200 rounded-lg overflow-hidden sticky top-4">
              <div className="bg-green-100 px-3 py-2 border-b border-green-200">
                <h3 className="text-sm font-semibold text-green-800">月次サマリー</h3>
              </div>
              <div className="p-3 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-700">売上</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {salesItem ? formatAmount(Math.round(getNumericValue(salesItem.id))) : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-700">客数</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {customersItem ? (getNumericValue(customersItem.id) || '-') : '-'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-700">客単価</span>
                  <span className="text-sm tabular-nums text-gray-500">
                    {unitPrice ? formatAmount(unitPrice) : '-'}
                  </span>
                </div>
                {discountItem && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-700">割引</span>
                    <span className="text-sm tabular-nums text-red-500">
                      {getNumericValue(discountItem.id) ? formatAmount(Math.round(getNumericValue(discountItem.id))) : '-'}
                    </span>
                  </div>
                )}

                <div className="border-t border-green-200 pt-3 space-y-2">
                  {EXPENSE_CATEGORIES.map(cat => {
                    const total = getCategoryTotal(cat)
                    if (total === 0) return null
                    return (
                      <div key={cat} className="flex justify-between items-center">
                        <span className="text-xs text-gray-600">{CATEGORY_LABELS[cat]}</span>
                        <span className="text-xs tabular-nums text-gray-600">{formatAmount(Math.round(total))}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-green-200 pt-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">支出合計</span>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatAmount(Math.round(expenseTotal))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">純利益</span>
                    <span className={`text-sm font-bold tabular-nums ${netProfit < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {salesItem && getNumericValue(salesItem.id) ? formatAmount(Math.round(netProfit)) : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">利益率</span>
                    <span className={`text-sm font-bold tabular-nums ${profitRate < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {salesItem && getNumericValue(salesItem.id) ? formatPercent(profitRate) : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Save button */}
            <div className="sticky top-[340px]">
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full py-2.5 px-4 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors text-sm"
              >
                {saving ? '保存中...' : '保存'}
              </button>
              {message && (
                <div className={`mt-2 px-3 py-2 rounded-md text-sm text-center ${
                  message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {message.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
