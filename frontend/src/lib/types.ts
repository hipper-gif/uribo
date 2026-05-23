export type ItemCategory =
  | '売上'
  | '変動費'      // 売上連動: cogs, supplies, fees, hpb
  | '人件費'      // 給料系: salary_total, bonus, recruitment, training, welfare, commute_allowance, transport_total
  | '法定費用'    // 強制(削減不可): legal_welfare, workers_comp, 税金系
  | '契約固定費'  // 月額固定・契約縛り: rent, franchise_fee, depreciation, insurance, shopping_street
  | 'インフラ'    // 使用量で半変動: electricity, gas, water_utility, communication, garbage
  | 'サブスク'    // 月額固定・解約容易: microsoft, spotify, amazon_prime, water_supply
  | 'スポット費用' // 不定期: travel_expense, repair, entertainment, meeting, advertising, outsourcing
  | '管理費'      // 本部按分: twinkle_fee
  | 'その他'      // discount, other_expense
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

export const EXPENSE_CATEGORIES: ItemCategory[] = [
  '変動費', '人件費', '法定費用', '契約固定費', 'インフラ', 'サブスク', 'スポット費用', '管理費', 'その他'
]
export const MGMT_FEE_CODE = 'twinkle_fee'

/** 税抜入力する item(DB保存時に×1.10して税込で保存)。受領レシートが税抜なケース。 */
export const TAX_EXCLUSIVE_INPUT_CODES = new Set<string>(['cogs', 'supplies'])

/** DataEntry「前月をコピー」対象カテゴリ(月額がほぼ固定で前月と同じ可能性高) */
export const COPY_PREV_CATEGORIES = new Set<ItemCategory>(['契約固定費', 'サブスク', '管理費'])

/** TargetSetting「固定費(前年コピー)」対象カテゴリ。売上に連動しない経費全般 */
export const TARGET_FIXED_COPY_CATEGORIES = new Set<ItemCategory>([
  '契約固定費', 'インフラ', 'サブスク', 'スポット費用', '管理費'
])

/** TargetSetting「変動費(売上連動比率)」対象カテゴリ */
export const TARGET_VARIABLE_CATEGORIES = new Set<ItemCategory>(['変動費'])

/** 表示モード: 税込 / 税抜 */
export type TaxMode = 'inclusive' | 'exclusive'

/** 消費税の対象外として税抜換算しない item_code (税抜モード時に ÷1.10 を適用しない) */
export const NON_TAXABLE_ITEM_CODES = new Set<string>([
  // 人件費系(給与・賞与は消費税対象外)
  'salary_total', 'bonus', 'recruitment', 'training',
  // 法定福利・社会保険系
  'legal_welfare', 'health_ins_total', 'workers_comp',
  // 通勤交通費(一定額まで非課税、実務上ほぼ非課税扱い)
  'transport_total',
  // 保険料(損害保険・生命保険は消費税非課税)
  'insurance',
  // 税金系(預かり税は BS 預り金、減価償却は非現金費用で消費税の話とは別)
  'withholding_tax', 'vat_purchase', 'net_payable_tax', 'depreciation',
  // 商店街費等の会費系
  'shopping_street',
])

/** 税抜モード時に課税科目を ÷1.10 する。非課税科目はそのまま返す */
export function applyTaxAdjust(itemCode: string, raw: number, mode: TaxMode): number {
  if (mode === 'inclusive') return raw
  if (NON_TAXABLE_ITEM_CODES.has(itemCode)) return raw
  return raw / 1.1
}

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
