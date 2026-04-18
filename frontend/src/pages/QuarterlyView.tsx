import { useState, useMemo, Fragment } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { StoreYearSelector } from '../components/StoreYearSelector'
import { MONTH_LABELS, EXPENSE_CATEGORIES, currentFiscalYear, formatAmount, formatPercent } from '../lib/types'

const QUARTERS = [
  { label: 'Q1 (4-6月)', months: [4, 5, 6] },
  { label: 'Q2 (7-9月)', months: [7, 8, 9] },
  { label: 'Q3 (10-12月)', months: [10, 11, 12] },
  { label: 'Q4 (1-3月)', months: [1, 2, 3] },
]

export function QuarterlyView() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [quarter, setQuarter] = useState(0)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

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

  const lookup = (dataset: typeof actualData, itemId: number, month: number) => {
    const found = dataset.find(d => d.item_id === itemId && d.month === month)
    return found ? parseFloat(found.amount) : 0
  }

  const q = QUARTERS[quarter]

  const salesItem = items.find(i => i.item_code === 'sales')

  function getCatTotal(cat: string, dataset: typeof actualData, month: number): number {
    return (expenseGroups[cat] ?? []).reduce((s, i) => s + lookup(dataset, i.id, month), 0)
  }

  const getExpenses = (dataset: typeof actualData, month: number) =>
    EXPENSE_CATEGORIES.reduce((s, cat) => s + getCatTotal(cat, dataset, month), 0)

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
      <h2 className="text-xl font-bold text-gray-900 mb-4">四半期成績</h2>
      <StoreYearSelector stores={stores} storeId={storeId} fiscalYear={fiscalYear}
        onStoreChange={setStoreId} onYearChange={setFiscalYear} showInactive />
      <div className="flex flex-wrap gap-1 mb-4">
        {QUARTERS.map((qq, i) => (
          <button key={i} onClick={() => setQuarter(i)}
            className={`px-3 py-2.5 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
              quarter === i ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>{qq.label}</button>
        ))}
      </div>

      {loading ? <div className="text-gray-500 py-8 text-center">読み込み中...</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="sticky left-0 z-20 bg-gray-100 px-2 py-2 text-left border border-gray-200 min-w-[120px]">科目</th>
                {q.months.map(m => (
                  <th key={m} colSpan={3} className="px-1 py-2 text-center border border-gray-200 min-w-[180px]">{MONTH_LABELS[m]}</th>
                ))}
                <th colSpan={3} className="px-1 py-2 text-center border border-gray-200 bg-gray-200 min-w-[180px]">四半期合計</th>
              </tr>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-20 bg-gray-50 border border-gray-200" />
                {[...q.months, 0].map((m, i) => (
                  <Fragment key={`${m}-${i}`}>
                    <th className="px-1 py-1 text-right text-[10px] border border-gray-200 text-blue-600">目標</th>
                    <th className="px-1 py-1 text-right text-[10px] border border-gray-200 text-gray-700">実績</th>
                    <th className="px-1 py-1 text-right text-[10px] border border-gray-200 text-gray-500">達成率</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 売上系: 常に個別表示 */}
              {salesItems.map(item => {
                const qTarget = q.months.reduce((s, m) => s + lookup(targetData, item.id, m), 0)
                const qActual = q.months.reduce((s, m) => s + lookup(actualData, item.id, m), 0)
                const qRate = qTarget ? qActual / qTarget : 0
                return (
                  <tr key={item.id} className={`hover:bg-gray-50 ${item.item_code === 'sales' ? 'bg-blue-50 font-semibold' : ''}`}>
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5 border border-gray-200 font-medium">{item.item_name}</td>
                    {q.months.map(m => {
                      const t = lookup(targetData, item.id, m)
                      const a = lookup(actualData, item.id, m)
                      const rate = t ? a / t : 0
                      return (
                        <Fragment key={m}>
                          <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums text-blue-600">{t ? formatAmount(Math.round(t)) : '-'}</td>
                          <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums">{a ? formatAmount(Math.round(a)) : '-'}</td>
                          <td className={`px-1 py-1.5 text-right border border-gray-200 tabular-nums ${rate >= 1 ? 'text-green-600' : rate > 0 ? 'text-red-500' : ''}`}>
                            {t && a ? formatPercent(rate) : '-'}
                          </td>
                        </Fragment>
                      )
                    })}
                    <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-blue-600 font-medium">{qTarget ? formatAmount(Math.round(qTarget)) : '-'}</td>
                    <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums font-medium">{qActual ? formatAmount(Math.round(qActual)) : '-'}</td>
                    <td className={`px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums font-medium ${qRate >= 1 ? 'text-green-600' : qRate > 0 ? 'text-red-500' : ''}`}>
                      {qTarget && qActual ? formatPercent(qRate) : '-'}
                    </td>
                  </tr>
                )
              })}

              {/* 経費カテゴリ: アコーディオン */}
              {EXPENSE_CATEGORIES.map(cat => {
                const catItems = expenseGroups[cat]
                if (!catItems || catItems.length === 0) return null
                const isExpanded = expandedCategories.has(cat)

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
                      {q.months.map(m => {
                        const t = getCatTotal(cat, targetData, m)
                        const a = getCatTotal(cat, actualData, m)
                        return (
                          <Fragment key={m}>
                            <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums text-blue-600 font-medium">{t ? formatAmount(Math.round(t)) : '-'}</td>
                            <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums font-medium">{a ? formatAmount(Math.round(a)) : '-'}</td>
                            <td className="px-1 py-1.5 text-right border border-gray-200" />
                          </Fragment>
                        )
                      })}
                      {(() => {
                        const qT = q.months.reduce((s, m) => s + getCatTotal(cat, targetData, m), 0)
                        const qA = q.months.reduce((s, m) => s + getCatTotal(cat, actualData, m), 0)
                        return (
                          <>
                            <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-200 tabular-nums text-blue-600 font-semibold">{qT ? formatAmount(Math.round(qT)) : '-'}</td>
                            <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-200 tabular-nums font-semibold">{qA ? formatAmount(Math.round(qA)) : '-'}</td>
                            <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-200" />
                          </>
                        )
                      })()}
                    </tr>

                    {/* 展開時: 個別科目 */}
                    {isExpanded && catItems.map(item => {
                      const qTarget = q.months.reduce((s, m) => s + lookup(targetData, item.id, m), 0)
                      const qActual = q.months.reduce((s, m) => s + lookup(actualData, item.id, m), 0)
                      const qRate = qTarget ? qActual / qTarget : 0
                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="sticky left-0 z-10 bg-white px-2 py-1.5 pl-7 border border-gray-200 text-gray-600 text-[11px]">{item.item_name}</td>
                          {q.months.map(m => {
                            const t = lookup(targetData, item.id, m)
                            const a = lookup(actualData, item.id, m)
                            const rate = t ? a / t : 0
                            return (
                              <Fragment key={m}>
                                <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums text-blue-400">{t ? formatAmount(Math.round(t)) : '-'}</td>
                                <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums text-gray-600">{a ? formatAmount(Math.round(a)) : '-'}</td>
                                <td className={`px-1 py-1.5 text-right border border-gray-200 tabular-nums text-gray-500 ${rate >= 1 ? 'text-green-600' : rate > 0 ? 'text-red-500' : ''}`}>
                                  {t && a ? formatPercent(rate) : '-'}
                                </td>
                              </Fragment>
                            )
                          })}
                          <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-blue-400">{qTarget ? formatAmount(Math.round(qTarget)) : '-'}</td>
                          <td className="px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-gray-600">{qActual ? formatAmount(Math.round(qActual)) : '-'}</td>
                          <td className={`px-1 py-1.5 text-right border border-gray-200 bg-gray-50 tabular-nums text-gray-500 ${qRate >= 1 ? 'text-green-600' : qRate > 0 ? 'text-red-500' : ''}`}>
                            {qTarget && qActual ? formatPercent(qRate) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                )
              })}

              {/* 純利益行 */}
              <tr className="bg-green-50 font-semibold border-t-2 border-gray-400">
                <td className="sticky left-0 z-10 bg-green-50 px-2 py-1.5 border border-gray-200">純利益</td>
                {q.months.map(m => {
                  const tSales = salesItem ? lookup(targetData, salesItem.id, m) : 0
                  const aSales = salesItem ? lookup(actualData, salesItem.id, m) : 0
                  const tProfit = tSales - getExpenses(targetData, m)
                  const aProfit = aSales - getExpenses(actualData, m)
                  const rate = tProfit ? aProfit / tProfit : 0
                  return (
                    <Fragment key={m}>
                      <td className="px-1 py-1.5 text-right border border-gray-200 tabular-nums text-blue-600">{tSales ? formatAmount(Math.round(tProfit)) : '-'}</td>
                      <td className={`px-1 py-1.5 text-right border border-gray-200 tabular-nums ${aProfit < 0 ? 'text-red-600' : ''}`}>{aSales ? formatAmount(Math.round(aProfit)) : '-'}</td>
                      <td className={`px-1 py-1.5 text-right border border-gray-200 tabular-nums ${rate >= 1 ? 'text-green-600' : rate > 0 ? 'text-red-500' : ''}`}>
                        {tProfit && aProfit ? formatPercent(rate) : '-'}
                      </td>
                    </Fragment>
                  )
                })}
                {(() => {
                  const qtSales = salesItem ? q.months.reduce((s, m) => s + lookup(targetData, salesItem.id, m), 0) : 0
                  const qaSales = salesItem ? q.months.reduce((s, m) => s + lookup(actualData, salesItem.id, m), 0) : 0
                  const qtExp = q.months.reduce((s, m) => s + getExpenses(targetData, m), 0)
                  const qaExp = q.months.reduce((s, m) => s + getExpenses(actualData, m), 0)
                  const qtProfit = qtSales - qtExp
                  const qaProfit = qaSales - qaExp
                  const rate = qtProfit ? qaProfit / qtProfit : 0
                  return (
                    <>
                      <td className="px-1 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums text-blue-600 font-semibold">{qtSales ? formatAmount(Math.round(qtProfit)) : '-'}</td>
                      <td className={`px-1 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums font-semibold ${qaProfit < 0 ? 'text-red-600' : ''}`}>{qaSales ? formatAmount(Math.round(qaProfit)) : '-'}</td>
                      <td className={`px-1 py-1.5 text-right border border-gray-200 bg-green-100 tabular-nums font-semibold ${rate >= 1 ? 'text-green-600' : rate > 0 ? 'text-red-500' : ''}`}>{qtProfit && qaProfit ? formatPercent(rate) : '-'}</td>
                    </>
                  )
                })()}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
