export type ItemCategory = '売上' | '仕入' | '人件費' | '法定福利' | '固定費' | '税金' | 'その他'
export type DataType = '実績' | '目標' | '見通し'

export interface BeautyStore {
  id: number; name: string; code: string; is_active: number
}

export interface BeautyItemMaster {
  id: number; item_category: ItemCategory; item_code: string; item_name: string
  unit: string; is_calculated: number; calc_formula: string | null; sort_order: number; is_active: number
}

export interface BeautyMonthlyData {
  id: number; store_id: number; fiscal_year: number; month: number
  data_type: DataType; item_id: number; amount: string; notes: string | null
}

export interface BeautyEmployeeMonthly {
  id: number; store_id: number; fiscal_year: number; month: number
  employee_name: string; data_type: DataType
  salary: string; transport_allowance: string; pension: string
  health_insurance: string; personal_sales: string; notes: string | null
}

export const EXPENSE_CATEGORIES: ItemCategory[] = ['仕入', '人件費', '法定福利', '固定費', '税金', 'その他']

// Fiscal year months in order
export const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3] as const
export const MONTH_LABELS: Record<number, string> = {
  4: '4月', 5: '5月', 6: '6月', 7: '7月', 8: '8月', 9: '9月',
  10: '10月', 11: '11月', 12: '12月', 1: '1月', 2: '2月', 3: '3月',
}

export function currentFiscalYear(): number {
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

export function formatAmount(amount: number): string {
  return amount.toLocaleString('ja-JP')
}

export function formatPercent(value: number): string {
  return (value * 100).toFixed(1) + '%'
}
