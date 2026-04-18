import { useState, useMemo } from 'react'
import { useStores, useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { StoreYearSelector } from '../components/StoreYearSelector'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatAmount, formatPercent } from '../lib/types'

export function MonthlyReport() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)

  const { data: actualData, loading } = useMonthlyData(storeId, fiscalYear, '実績')
  const { data: targetData } = useMonthlyData(storeId, fiscalYear, '目標')

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated).sort((a, b) => a.sort_order - b.sort_order), [items])

  const salesItem = items.find(i => i.item_code === 'sales')
  const expenseCategories = ['仕入', '人件費', '法定福利', '固定費', '税金', 'その他']

  const getVal = (dataset: typeof actualData, itemId: number, m: number) => {
    const found = dataset.find(d => d.item_id === itemId && d.month === m)
    return found ? parseFloat(found.amount) : 0
  }

  const prevMonth = month === 4 ? 3 : month - 1

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">月次成績</h2>
      <StoreYearSelector stores={stores} storeId={storeId} fiscalYear={fiscalYear}
        onStoreChange={setStoreId} onYearChange={setFiscalYear} showInactive />
      <div className="flex flex-wrap gap-1 mb-4">
        {FISCAL_MONTHS.map(m => (
          <button key={m} onClick={() => setMonth(m)}
            className={`px-3 py-2.5 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
              month === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}>{MONTH_LABELS[m]}</button>
        ))}
      </div>

      {loading ? <div className="text-gray-500 py-8 text-center">読み込み中...</div> : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="px-3 py-2 text-left border border-gray-200 min-w-[140px]">科目</th>
                <th className="px-3 py-2 text-right border border-gray-200 min-w-[100px] text-blue-600">目標</th>
                <th className="px-3 py-2 text-right border border-gray-200 min-w-[100px]">実績</th>
                <th className="px-3 py-2 text-right border border-gray-200 min-w-[80px]">達成率</th>
                <th className="px-3 py-2 text-right border border-gray-200 min-w-[100px] text-gray-500">前月実績</th>
                <th className="px-3 py-2 text-right border border-gray-200 min-w-[80px] text-gray-500">前月比</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map(item => {
                const target = getVal(targetData, item.id, month)
                const actual = getVal(actualData, item.id, month)
                const prev = getVal(actualData, item.id, prevMonth)
                const achievement = target ? actual / target : 0
                const momRatio = prev ? actual / prev : 0
                return (
                  <tr key={item.id} className={`hover:bg-gray-50 ${item.item_code === 'sales' ? 'bg-blue-50 font-semibold' : ''}`}>
                    <td className="px-3 py-2 border border-gray-200 font-medium">{item.item_name}</td>
                    <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-blue-600">{target ? formatAmount(Math.round(target)) : '-'}</td>
                    <td className="px-3 py-2 text-right border border-gray-200 tabular-nums">{actual ? formatAmount(Math.round(actual)) : '-'}</td>
                    <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums ${achievement >= 1 ? 'text-green-600' : achievement > 0 ? 'text-red-500' : ''}`}>
                      {target && actual ? formatPercent(achievement) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-gray-500">{prev ? formatAmount(Math.round(prev)) : '-'}</td>
                    <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums ${momRatio >= 1 ? 'text-green-600' : momRatio > 0 ? 'text-red-500' : ''}`}>
                      {prev && actual ? formatPercent(momRatio) : '-'}
                    </td>
                  </tr>
                )
              })}
              {/* 支出合計 + 純利益 + 利益率 */}
              {(() => {
                const tSales = salesItem ? getVal(targetData, salesItem.id, month) : 0
                const aSales = salesItem ? getVal(actualData, salesItem.id, month) : 0
                const pSales = salesItem ? getVal(actualData, salesItem.id, prevMonth) : 0
                const tExp = displayItems.filter(i => expenseCategories.includes(i.item_category)).reduce((s, i) => s + getVal(targetData, i.id, month), 0)
                const aExp = displayItems.filter(i => expenseCategories.includes(i.item_category)).reduce((s, i) => s + getVal(actualData, i.id, month), 0)
                const pExp = displayItems.filter(i => expenseCategories.includes(i.item_category)).reduce((s, i) => s + getVal(actualData, i.id, prevMonth), 0)
                const tProfit = tSales - tExp
                const aProfit = aSales - aExp
                const pProfit = pSales - pExp
                return (
                  <>
                    <tr className="bg-yellow-50 font-semibold border-t-2 border-gray-400">
                      <td className="px-3 py-2 border border-gray-200">支出合計</td>
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-blue-600">{tExp ? formatAmount(Math.round(tExp)) : '-'}</td>
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums">{aExp ? formatAmount(Math.round(aExp)) : '-'}</td>
                      <td className="px-3 py-2 text-right border border-gray-200" />
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-gray-500">{pExp ? formatAmount(Math.round(pExp)) : '-'}</td>
                      <td className="px-3 py-2 border border-gray-200" />
                    </tr>
                    <tr className="bg-green-50 font-semibold">
                      <td className="px-3 py-2 border border-gray-200">純利益</td>
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-blue-600">{tSales ? formatAmount(Math.round(tProfit)) : '-'}</td>
                      <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums ${aProfit < 0 ? 'text-red-600' : ''}`}>{aSales ? formatAmount(Math.round(aProfit)) : '-'}</td>
                      <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums ${tProfit && aProfit / tProfit >= 1 ? 'text-green-600' : 'text-red-500'}`}>{tProfit ? formatPercent(aProfit / tProfit) : '-'}</td>
                      <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums text-gray-500 ${pProfit < 0 ? 'text-red-600' : ''}`}>{pSales ? formatAmount(Math.round(pProfit)) : '-'}</td>
                      <td className="px-3 py-2 border border-gray-200" />
                    </tr>
                    <tr className="bg-green-50">
                      <td className="px-3 py-2 border border-gray-200 font-medium">利益率</td>
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-blue-600">{tSales ? formatPercent(tProfit / tSales) : '-'}</td>
                      <td className={`px-3 py-2 text-right border border-gray-200 tabular-nums ${aSales && aProfit / aSales < 0 ? 'text-red-600' : ''}`}>{aSales ? formatPercent(aProfit / aSales) : '-'}</td>
                      <td className="px-3 py-2 border border-gray-200" />
                      <td className="px-3 py-2 text-right border border-gray-200 tabular-nums text-gray-500">{pSales ? formatPercent(pProfit / pSales) : '-'}</td>
                      <td className="px-3 py-2 border border-gray-200" />
                    </tr>
                  </>
                )
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
