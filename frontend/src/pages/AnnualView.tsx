import { useState, useMemo } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { StoreYearSelector } from '../components/StoreYearSelector'
import { FISCAL_MONTHS, MONTH_LABELS, EXPENSE_CATEGORIES, currentFiscalYear, formatAmount, formatPercent } from '../lib/types'
import type { DataType } from '../lib/types'

export function AnnualView() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [dataType, setDataType] = useState<DataType>('実績')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const { data, loading } = useMonthlyData(storeId, fiscalYear, dataType)
  const { data: targetData } = useMonthlyData(storeId, fiscalYear, dataType === '実績' ? '目標' : undefined)

  const lookup = useMemo(() => {
    const map: Record<number, Record<number, number>> = {}
    for (const d of data) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = parseFloat(d.amount)
    }
    return map
  }, [data])

  const targetLookup = useMemo(() => {
    if (dataType !== '実績') return {}
    const map: Record<number, Record<number, number>> = {}
    for (const d of targetData) {
      if (!map[d.item_id]) map[d.item_id] = {}
      map[d.item_id][d.month] = parseFloat(d.amount)
    }
    return map
  }, [targetData, dataType])

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

  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])

  function getVal(itemId: number, month: number): number {
    return lookup[itemId]?.[month] ?? 0
  }

  function getRowTotal(itemId: number): number {
    return FISCAL_MONTHS.reduce((sum, m) => sum + getVal(itemId, m), 0)
  }

  function getCatTotal(cat: string, month: number): number {
    return (expenseGroups[cat] ?? []).reduce((sum, i) => sum + getVal(i.id, month), 0)
  }

  function getCatTargetTotal(cat: string, month: number): number {
    return (expenseGroups[cat] ?? []).reduce((sum, i) => sum + (targetLookup[i.id]?.[month] ?? 0), 0)
  }

  function getExpenseTotal(month: number): number {
    return EXPENSE_CATEGORIES.reduce((sum, cat) => sum + getCatTotal(cat, month), 0)
  }

  function getSalesAmount(month: number): number {
    return salesItem ? getVal(salesItem.id, month) : 0
  }

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">年間成績一覧</h2>
      <StoreYearSelector stores={stores} storeId={storeId} fiscalYear={fiscalYear}
        dataType={dataType} onStoreChange={setStoreId} onYearChange={setFiscalYear}
        onDataTypeChange={setDataType} showDataType showInactive />

      {loading ? (
        <div className="text-gray-500 py-8 text-center">読み込み中...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="sticky left-0 z-20 bg-gray-100 px-2 py-2 text-left font-medium text-gray-700 border border-gray-200 min-w-[120px]">科目</th>
                {FISCAL_MONTHS.map(m => (
                  <th key={m} className="px-2 py-2 text-right font-medium text-gray-700 border border-gray-200 min-w-[80px]">{MONTH_LABELS[m]}</th>
                ))}
                <th className="px-2 py-2 text-right font-medium text-gray-700 border border-gray-200 min-w-[90px] bg-gray-200">合計</th>
                <th className="px-2 py-2 text-right font-medium text-gray-700 border border-gray-200 min-w-[80px] bg-gray-200">平均</th>
              </tr>
            </thead>
            <tbody>
              {/* 売上系: 常に個別表示 */}
              {salesItems.map(item => {
                const total = getRowTotal(item.id)
                const avg = total / 12
                const isSales = item.item_code === 'sales'
                const isCustomers = item.item_code === 'customers'
                return (
                  <tr key={item.id} className={`${isSales ? 'bg-blue-50 font-semibold' : ''} hover:bg-gray-50`}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5 border border-gray-200 text-gray-800 font-medium">
                      {item.item_name}
                    </td>
                    {FISCAL_MONTHS.map(m => {
                      const val = getVal(item.id, m)
                      const tgt = targetLookup[item.id]?.[m]
                      const showComparison = dataType === '実績' && tgt !== undefined && val !== 0
                      const achievement = showComparison && tgt ? val / tgt : null
                      return (
                        <td key={m} className="px-2 py-1.5 text-right border border-gray-200 tabular-nums">
                          <div>{val ? (isCustomers ? val.toLocaleString() : formatAmount(Math.round(val))) : '-'}</div>
                          {achievement !== null && (
                            <div className={`text-[10px] ${achievement >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                              {formatPercent(achievement)}
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-50 font-semibold tabular-nums">
                      {total ? (isCustomers ? total.toLocaleString() : formatAmount(Math.round(total))) : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums">
                      {total ? (isCustomers ? Math.round(avg).toLocaleString() : formatAmount(Math.round(avg))) : '-'}
                    </td>
                  </tr>
                )
              })}

              {/* 経費カテゴリ: アコーディオン */}
              {EXPENSE_CATEGORIES.map(cat => {
                const catItems = expenseGroups[cat]
                if (!catItems || catItems.length === 0) return null
                const isExpanded = expandedCategories.has(cat)
                const catAnnualTotal = FISCAL_MONTHS.reduce((s, m) => s + getCatTotal(cat, m), 0)

                return (
                  <tbody key={cat}>
                    {/* カテゴリ小計行 */}
                    <tr
                      className="bg-gray-100 cursor-pointer hover:bg-gray-200 border-t-2 border-gray-300 select-none"
                      onClick={() => toggleCategory(cat)}
                    >
                      <td className="sticky left-0 z-10 bg-gray-100 px-2 py-1.5 border border-gray-200 font-semibold text-gray-700">
                        <span className="inline-block w-4 text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                        {cat}
                      </td>
                      {FISCAL_MONTHS.map(m => {
                        const val = getCatTotal(cat, m)
                        const tgt = dataType === '実績' ? getCatTargetTotal(cat, m) : 0
                        const achievement = tgt && val ? val / tgt : null
                        return (
                          <td key={m} className="px-2 py-1.5 text-right border border-gray-200 tabular-nums font-medium">
                            <div>{val ? formatAmount(Math.round(val)) : '-'}</div>
                            {achievement !== null && (
                              <div className={`text-[10px] ${achievement >= 1 ? 'text-green-600' : 'text-red-500'}`}>
                                {formatPercent(achievement)}
                              </div>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-200 font-semibold tabular-nums">
                        {catAnnualTotal ? formatAmount(Math.round(catAnnualTotal)) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-200 tabular-nums">
                        {catAnnualTotal ? formatAmount(Math.round(catAnnualTotal / 12)) : '-'}
                      </td>
                    </tr>

                    {/* 展開時: 個別科目 */}
                    {isExpanded && catItems.map(item => {
                      const total = getRowTotal(item.id)
                      const avg = total / 12
                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="sticky left-0 z-10 bg-white px-2 py-1.5 pl-7 border border-gray-200 text-gray-600 text-[11px]">
                            {item.item_name}
                          </td>
                          {FISCAL_MONTHS.map(m => {
                            const val = getVal(item.id, m)
                            return (
                              <td key={m} className="px-2 py-1.5 text-right border border-gray-200 tabular-nums text-gray-600">
                                {val ? formatAmount(Math.round(val)) : '-'}
                              </td>
                            )
                          })}
                          <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-gray-600">
                            {total ? formatAmount(Math.round(total)) : '-'}
                          </td>
                          <td className="px-2 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-gray-600">
                            {total ? formatAmount(Math.round(avg)) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
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
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-yellow-100 tabular-nums">
                  {formatAmount(Math.round(FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0) / 12))}
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
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums">
                  {formatAmount(Math.round(FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m) - getExpenseTotal(m), 0) / 12))}
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
                <td className="px-2 py-1.5 text-right border border-gray-200 bg-green-100" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
