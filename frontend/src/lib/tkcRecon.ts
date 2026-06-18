/** TKC残差突合（正しさ検証 / Phase2）
 *
 * 狙い: TKC(税理士確定値)=会計上のground truth と うりぼー実績を突合する。
 *   ただし両者には【意図的な差】が多数ある(uribo/CLAUDE.md「TKC連携イレギュラー運用」)。
 *   そこで意図的差分を下記 RECON_RULES に"宣言"し、
 *     残差 = うりぼー実績 − (TKC値 + 意図的差分)
 *   を計算する。残差≒0=正しい / 残差>許容=真の誤り として検知する。
 *
 * ★最大リスク: この宣言表が運用変更に追従しないと突合が無意味化する。
 *   各ルールの claudeRef を uribo/CLAUDE.md の該当節と1対1で対応させ、CLAUDE.md改訂時に必ず同期すること。
 *
 * 比較基準: 税込。TKC勘定科目残高は税抜前提(TKC_BALANCE_IS_TAX_EXCLUSIVE)で、課税科目は×1.10して税込換算する。
 *   ※もしTKC側が税込出力なら TKC_BALANCE_IS_TAX_EXCLUSIVE=false に切り替えるだけでよい。
 */

export const TKC_BALANCE_IS_TAX_EXCLUSIVE = true

export interface ReconRule {
  key: string
  label: string
  tkcCodes: string[]
  uriboCodes: string[]
  /** TKC側が課税科目か(税込換算で×1.10するか) */
  taxable: boolean
  /** 意図的差分(税込・月額・円)。expected = tkcIncl + offsetIncl */
  offsetIncl: number
  /** auto=残差を自動判定 / manual=税区分混在等で自動判定せず情報のみ */
  mode: 'auto' | 'manual'
  /** 許容残差(円) */
  tol: number
  /** 4111のみ: うりぼー側を (sales − discount) で評価 */
  salesSpecial?: boolean
  /** CLAUDE.md「TKC連携イレギュラー運用」の該当節 */
  claudeRef: string
  note: string
}

export const RECON_RULES: ReconRule[] = [
  { key: 'sales', label: '売上', tkcCodes: ['4111'], uriboCodes: ['sales'], salesSpecial: true, taxable: true, offsetIncl: 0, mode: 'auto', tol: 5000, claudeRef: 'インポート設計含意/売上(4111)', note: 'うりぼー(税込売上−割引)がTKC×1.10と一致するか' },
  { key: 'cogs', label: '材料仕入', tkcCodes: ['5211'], uriboCodes: ['cogs'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 3000, claudeRef: '6. cogsとsuppliesの分離', note: '5211→cogs' },
  { key: 'supplies', label: '備品消耗品', tkcCodes: ['6225'], uriboCodes: ['supplies'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 5000, claudeRef: '6. cogsとsuppliesの分離', note: '6225→supplies(鍵交換等で月変動大)' },
  { key: 'transport', label: '通勤交通費', tkcCodes: ['6111'], uriboCodes: ['transport_total'], taxable: false, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: '7. transport_total', note: '6111→transport_total(非課税)' },
  { key: 'travel', label: '旅費交通費', tkcCodes: ['6112'], uriboCodes: ['travel_expense'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: '—', note: '6112→travel_expense' },
  { key: 'ad', label: '広告宣伝費', tkcCodes: ['6113'], uriboCodes: ['hpb', 'advertising'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 3000, claudeRef: 'TKC_SUBCLASSIFIERS 6113', note: '6113→hpb/advertising' },
  { key: 'royalty', label: 'ロイヤルティ', tkcCodes: ['6118'], uriboCodes: ['franchise_fee'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 1000, claudeRef: '—', note: '6118→franchise_fee' },
  { key: 'comm', label: '通信費', tkcCodes: ['6218'], uriboCodes: ['communication', 'microsoft', 'spotify', 'amazon_prime'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: 'TKC_SUBCLASSIFIERS 6218', note: '6218→通信+サブスク(合算で一致)' },
  { key: 'utility', label: '水道光熱費', tkcCodes: ['6219'], uriboCodes: ['electricity', 'gas', 'water_utility'], taxable: true, offsetIncl: 3000, mode: 'auto', tol: 2500, claudeRef: '4. 寝屋川店の家賃構成', note: '6219+寝屋川水道3000(6215から分離)' },
  { key: 'rent', label: '地代家賃', tkcCodes: ['6215'], uriboCodes: ['rent'], taxable: true, offsetIncl: -3000, mode: 'auto', tol: 2500, claudeRef: '4. 寝屋川店の家賃構成', note: '6215−寝屋川水道3000(water_utilityへ)' },
  { key: 'welfare', label: '福利厚生費', tkcCodes: ['6226'], uriboCodes: ['water_supply', 'welfare'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: 'TKC_SUBCLASSIFIERS 6226', note: '6226→水サーバー/福利' },
  { key: 'fees', label: '支払手数料', tkcCodes: ['6227'], uriboCodes: ['fees', 'garbage'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: 'TKC_SUBCLASSIFIERS 6227', note: '6227→手数料+ゴミ回収' },
  { key: 'meeting', label: '会議費', tkcCodes: ['6228'], uriboCodes: ['meeting'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 1000, claudeRef: '—', note: '6228→meeting' },
  { key: 'entertainment', label: '接待交際費', tkcCodes: ['6223'], uriboCodes: ['entertainment'], taxable: true, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: '—', note: '6223→entertainment' },
  { key: 'legal', label: '法定福利費', tkcCodes: ['6312'], uriboCodes: ['legal_welfare', 'health_ins_total', 'workers_comp'], taxable: false, offsetIncl: 0, mode: 'auto', tol: 2000, claudeRef: '—', note: '6312→法定福利(非課税)' },
  // ── 複合(税区分混在・按分のため自動判定しない。情報として残差を表示) ──
  { key: 'labor', label: '人件費・外注(複合)', tkcCodes: ['6212', '6117'], uriboCodes: ['salary_total', 'twinkle_fee', 'outsourcing'], taxable: false, offsetIncl: -40000, mode: 'manual', tol: 0, claudeRef: '1.Twinkle代 / 2.和田 / 3.6117', note: 'TKC(6212+6117)−40000介護 ≒ うりぼー(給与+Twinkle代+外注)。Twinkle按分・和田→給与・税区分混在のため手動確認' },
]

export interface ReconResult {
  rule: ReconRule
  tkcRawTotal: number
  tkcInclTotal: number
  uriboTotal: number
  expectedIncl: number
  residual: number
  withinTol: boolean
}

/** 1ヶ月分の残差突合。
 *  tkcAt(code) = TKC科目の当月値(残高推移表の生値) / uriboAt(code) = うりぼー当月実績(税込・全店合算) */
export function reconcileMonth(
  tkcAt: (code: string) => number,
  uriboAt: (code: string) => number,
): ReconResult[] {
  const toIncl = (raw: number, taxable: boolean) =>
    taxable && TKC_BALANCE_IS_TAX_EXCLUSIVE ? Math.round(raw * 1.1) : raw

  return RECON_RULES.map(rule => {
    const tkcRawTotal = rule.tkcCodes.reduce((s, c) => s + tkcAt(c), 0)
    const tkcInclTotal = toIncl(tkcRawTotal, rule.taxable)
    const uriboTotal = rule.salesSpecial
      ? (uriboAt('sales') - uriboAt('discount'))
      : rule.uriboCodes.reduce((s, c) => s + uriboAt(c), 0)
    const expectedIncl = tkcInclTotal + rule.offsetIncl
    const residual = Math.round(uriboTotal - expectedIncl)
    const withinTol = rule.mode === 'auto' ? Math.abs(residual) <= rule.tol : true
    return { rule, tkcRawTotal, tkcInclTotal, uriboTotal: Math.round(uriboTotal), expectedIncl, residual, withinTol }
  })
}
