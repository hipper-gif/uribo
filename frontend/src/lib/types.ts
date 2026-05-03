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

export interface BeautyMonthlyMeta {
  id: number; store_id: number; fiscal_year: number; month: number
  data_type: DataType
  notes: string | null
  fulltime_count: number | null
  parttime_count: number | null
}

export const EXPENSE_CATEGORIES: ItemCategory[] = ['仕入', '人件費', '法定福利', '固定費', '税金', 'その他']
export const MGMT_FEE_CODE = 'twinkle_fee'

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

/** Format in 万 (10k) units for compact display */
export function formatMan(n: number): string {
  if (Math.abs(n) >= 10000) return (n / 10000).toFixed(n >= 1000000 ? 0 : 1) + '万'
  return Math.round(n).toLocaleString('ja-JP')
}

/** is_calculated=1 の派生項目の値を、入力済み値から導出する。
 *  対応していない item_code は null を返すので、呼び出し側はそのまま表示しないこと。
 *  values は item_code -> 数値 の lookup。
 */
export function calcDerivedAmount(
  itemCode: string,
  values: Record<string, number>,
): number | null {
  const v = (k: string) => values[k] ?? 0
  switch (itemCode) {
    case 'unit_price': {
      const c = v('customers')
      return c > 0 ? Math.round(v('sales') / c) : 0
    }
    case 'vat_purchase':
      // 仕入消費税 = (仕入 + 消耗品商品) ÷ 11 (税込10%相当, floor)
      return Math.floor((v('cogs') + v('supplies')) / 11)
    case 'net_payable_tax':
      // 納付税額 = 預かり税 - 仕入消費税
      return v('withholding_tax') - Math.floor((v('cogs') + v('supplies')) / 11)
    default:
      return null
  }
}

/** UI 派生計算で参照する全 item_code を列挙（lookup 構築のヒント用） */
export const DERIVED_INPUT_CODES = ['sales', 'customers', 'cogs', 'supplies', 'withholding_tax'] as const
export const DERIVED_OUTPUT_CODES = ['unit_price', 'vat_purchase', 'net_payable_tax'] as const
