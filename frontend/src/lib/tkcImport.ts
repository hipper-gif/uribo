/** TKC 仕訳帳CSV → うりぼー beauty_monthly_data 変換ロジック
 *
 * 重要なイレギュラー運用ルール(uribo/CLAUDE.md 参照):
 * - 6117 外注費: Twinkle代水増し + 和田委託費 + 真の外注 が混在。Twinkle代/和田は別計上、残りのみ outsourcing
 * - 4111 売上: うりぼー sales = TKC 4111 + 既存 discount (税込)
 * - 過去 rent との比較は意味なし(過去は固定費混入)
 * - cogs(5211)/supplies(6225) は分けて入れる
 * - transport_total は給料計算経路で既に入っている可能性。差分のみ反映 or 上書き選択
 */

/** TKC 部門コード → うりぼー store_id */
export const TKC_DEPT_TO_STORE: Record<string, { storeId: number; storeName: string }> = {
  '011': { storeId: 1, storeName: '寝屋川店' },
  '012': { storeId: 2, storeName: '守口店' },
}

/** TKC 科目 → うりぼー item_code の対応 + 振り分け規則 */
export interface TkcMappingRule {
  /** うりぼー item_code 候補(複数可) */
  uribo_codes: string[]
  /** 「残額の受け皿」となる主item(1対多のとき、既存値以外を集約する先) */
  primary?: string
  /** 表示用補足 */
  note?: string
  /** 既定で取込対象から除外する(BS科目・営業外等) */
  skip?: boolean
}

/** 6117 外注費の内訳判定: 取引先名/摘要から「Twinkle代/和田委託費/その他真の外注」を識別
 *  Twinkle代/和田はうりぼー側で別計上(twinkle_fee/salary_total)のためインポート対象外
 */
export type OutsourcingKind = 'twinkle' | 'wada' | 'other'
export function classifyOutsourcing(trader: string, memo: string): OutsourcingKind {
  const s = (trader + ' ' + memo).toLowerCase()
  // 「テインクル」「ティンクル」「twinkle」「スギハラ」「杉原」「ソウカ」「爽夏」を含むなら Twinkle代
  if (/テインクル|ティンクル|ﾃｲﾝｸﾙ|twinkle|スギハラ|杉原|ｽｷﾞﾊﾗ|ソウカ|爽夏|ｿｳｶ/i.test(trader + memo)) return 'twinkle'
  // 「ワダ」「和田」を含むなら和田委託費
  if (/ワダ|和田|ﾜﾀﾞ|wada/i.test(s)) return 'wada'
  return 'other'
}

/** 6117 の集計エントリを Twinkle代/和田/その他で分類した内訳を返す */
export function classifyOutsourcingBreakdown(entry: AggregatedEntry): { twinkle: number; wada: number; other: number; total: number } {
  const bd = { twinkle: 0, wada: 0, other: 0, total: 0 }
  for (const d of entry.details) {
    const k = classifyOutsourcing(d.trader, d.memo)
    bd[k] += d.amount
    bd.total += d.amount
  }
  return bd
}

export const TKC_RULES: Record<string, TkcMappingRule & { name: string }> = {
  '4111': { name: '売上高', uribo_codes: [], skip: true, note: '売上はSalonBoard取込済のためインポート対象外' },
  '5211': { name: '材料仕入高', uribo_codes: ['cogs'] },
  '6111': { name: '通勤交通費', uribo_codes: ['transport_total'], note: 'Payroll経路で既に入力されている可能性あり' },
  '6112': { name: '旅費交通費', uribo_codes: ['travel_expense'] },
  '6113': { name: '広告宣伝費', uribo_codes: ['hpb', 'advertising'], primary: 'advertising', note: 'HPB既存値を維持、残額を advertising へ' },
  '6116': { name: '採用教育費', uribo_codes: ['training', 'recruitment'], primary: 'recruitment' },
  '6117': { name: '外注費', uribo_codes: ['outsourcing'], note: '★Twinkle代水増し+和田委託費が混入。明細を要確認' },
  '6118': { name: 'ロイヤルティ', uribo_codes: ['franchise_fee'] },
  '6212': { name: '従業員給与', uribo_codes: ['salary_total'] },
  '6214': { name: '減価償却費', uribo_codes: ['depreciation'] },
  '6215': { name: '地代家賃', uribo_codes: ['rent'], note: '寝屋川店は請求124k=家賃121k+水道3k分離。要確認' },
  '6216': { name: '修繕費', uribo_codes: ['repair'] },
  '6218': { name: '通信費', uribo_codes: ['microsoft', 'spotify', 'amazon_prime', 'communication'], primary: 'communication', note: 'サブスク既存値を維持、電話/ネット等を communication へ' },
  '6219': { name: '水道光熱費', uribo_codes: ['water_utility', 'water_supply', 'electricity', 'gas'], primary: 'electricity', note: '水道既存値を維持、電気/ガスを別途' },
  '6223': { name: '接待交際費', uribo_codes: ['entertainment'] },
  '6224': { name: '保険料', uribo_codes: ['insurance'] },
  '6225': { name: '備品消耗品費', uribo_codes: ['supplies'] },
  '6226': { name: '福利厚生費', uribo_codes: ['welfare'] },
  '6227': { name: '支払手数料', uribo_codes: ['fees'] },
  '6228': { name: '会議費', uribo_codes: ['meeting'] },
  '6312': { name: '法定福利費', uribo_codes: ['legal_welfare'], note: '貸方分(預り)も発生するが借方ベースで計上' },
  // BS・営業外はスキップ
  '1111': { name: '現金', uribo_codes: [], skip: true },
  '1113': { name: '普通預金', uribo_codes: [], skip: true },
  '1122': { name: '売掛金', uribo_codes: [], skip: true },
  '2112': { name: '買掛金', uribo_codes: [], skip: true },
  '2115': { name: '未払費用', uribo_codes: [], skip: true },
  '2117': { name: '預り金', uribo_codes: [], skip: true },
  '2212': { name: '長期借入金', uribo_codes: [], skip: true },
  '2213': { name: '役員等長期借入金', uribo_codes: [], skip: true },
  '2219': { name: '長期未払金', uribo_codes: [], skip: true },
  '7511': { name: '支払利息', uribo_codes: [], skip: true, note: '営業外費用のためうりぼう管理外' },
}

export interface ParsedJournalRow {
  date: string
  month: number
  debit_code: string
  debit_name: string
  debit_dept: string
  debit_incl: number
  debit_excl: number
  credit_code: string
  credit_name: string
  credit_dept: string
  credit_incl: number
  credit_excl: number
  memo: string
}

export interface ParsedJournalRowWithTrader extends ParsedJournalRow {
  trader: string
}

/** UTF-8 BOM 仕訳帳CSV をパース */
export function parseJournalCsv(text: string): ParsedJournalRowWithTrader[] {
  // BOM除去
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []

  const out: ParsedJournalRowWithTrader[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    if (cells.length < 49) continue
    const date = cells[0]
    const m = date.match(/^\d{4}\/(\d{1,2})\/\d{1,2}$/)
    if (!m) continue
    out.push({
      date,
      month: parseInt(m[1], 10),
      debit_code: cells[3],
      debit_name: cells[4],
      debit_dept: cells[7],
      debit_incl: parseInt(cells[14] || '0', 10) || 0,
      debit_excl: parseInt(cells[16] || '0', 10) || 0,
      credit_code: cells[17],
      credit_name: cells[18],
      credit_dept: cells[21],
      credit_incl: parseInt(cells[28] || '0', 10) || 0,
      credit_excl: parseInt(cells[30] || '0', 10) || 0,
      memo: cells[33] ?? '',
      trader: cells[32] ?? '',
    })
  }
  return out
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { cells.push(cur); cur = '' }
      else cur += c
    }
  }
  cells.push(cur)
  return cells
}

/** 集計結果: (TKC科目コード × 部門コード) → 税込金額合計 */
export interface AggregatedEntry {
  tkc_code: string
  tkc_name: string
  store_id: number
  store_name: string
  month: number
  /** 借方 or 貸方ベースの税込合計(売上は貸方、それ以外は借方) */
  amount_incl: number
  /** 税抜合計(参考表示) */
  amount_excl: number
  /** 元となった仕訳行(プレビューで内訳表示用) */
  details: { date: string; trader: string; memo: string; amount: number }[]
}

/** 仕訳行を美容部門×TKC科目で集計
 *  - 4111(売上): 貸方 が美容部門の行を集計
 *  - その他: 借方 が美容部門の行を集計
 *  - 借方/貸方で同じTKCコードが両側に出る場合(法定福利費の還付等)は借方優先
 */
export function aggregateBeauty(rows: ParsedJournalRowWithTrader[], month: number): AggregatedEntry[] {
  const acc = new Map<string, AggregatedEntry>()
  const ensure = (code: string, name: string, store_id: number, store_name: string) => {
    const key = `${code}|${store_id}`
    let e = acc.get(key)
    if (!e) {
      e = { tkc_code: code, tkc_name: name, store_id, store_name, month, amount_incl: 0, amount_excl: 0, details: [] }
      acc.set(key, e)
    }
    return e
  }
  for (const r of rows) {
    if (r.month !== month) continue
    // 借方が美容
    const debitStore = TKC_DEPT_TO_STORE[r.debit_dept]
    if (debitStore && r.debit_code) {
      const e = ensure(r.debit_code, r.debit_name, debitStore.storeId, debitStore.storeName)
      e.amount_incl += r.debit_incl
      e.amount_excl += r.debit_excl
      e.details.push({ date: r.date, trader: r.trader ?? '', memo: r.memo, amount: r.debit_incl })
    }
    // 貸方が美容 (主に売上)
    const creditStore = TKC_DEPT_TO_STORE[r.credit_dept]
    if (creditStore && r.credit_code === '4111') {
      const e = ensure(r.credit_code, r.credit_name, creditStore.storeId, creditStore.storeName)
      e.amount_incl += r.credit_incl
      e.amount_excl += r.credit_excl
      e.details.push({ date: r.date, trader: r.trader ?? '', memo: r.memo, amount: r.credit_incl })
    }
  }
  return Array.from(acc.values()).sort((a, b) => {
    if (a.store_id !== b.store_id) return a.store_id - b.store_id
    return a.tkc_code.localeCompare(b.tkc_code)
  })
}

/** うりぼー DB へ反映する 1つの割当 */
export interface AssignmentDraft {
  /** 元TKC科目(参照表示用) */
  tkc_code: string
  store_id: number
  item_code: string
  item_id: number | null
  amount: number
  /** 既存うりぼー値(あれば) */
  existing_amount: number | null
  /** 既存行の id (PATCH対象、なければ POST) */
  existing_row_id: number | null
}

/** 集計を、各うりぼー item へ自動振り分け(既存値考慮)
 *  - 単一item: 全額をその item へ
 *  - 1対多 with primary: primary以外は既存値を維持、primary に残額(TKC合計 − 他itemの既存値)
 *  - 1対多 without primary: 全額を最初のitemに寄せる(編集してもらう前提)
 */
export interface DraftBuilderInput {
  entry: AggregatedEntry
  itemByCode: Record<string, { id: number; item_code: string }>
  existingByStoreItem: Record<string, { id: number; amount: number }>
}

export function buildDraftAssignments(input: DraftBuilderInput): AssignmentDraft[] {
  const { entry, itemByCode, existingByStoreItem } = input
  const rule = TKC_RULES[entry.tkc_code]
  if (!rule || rule.skip || rule.uribo_codes.length === 0) return []
  const codes = rule.uribo_codes.filter(c => itemByCode[c])
  if (codes.length === 0) return []

  const exKey = (code: string) => `${entry.store_id}|${itemByCode[code]?.id}`
  const drafts: AssignmentDraft[] = codes.map(code => {
    const it = itemByCode[code]
    const ex = existingByStoreItem[exKey(code)]
    return {
      tkc_code: entry.tkc_code,
      store_id: entry.store_id,
      item_code: code,
      item_id: it?.id ?? null,
      amount: 0,
      existing_amount: ex?.amount ?? null,
      existing_row_id: ex?.id ?? null,
    }
  })

  // 単一item: 全額
  if (codes.length === 1) {
    drafts[0].amount = entry.amount_incl
    return drafts
  }

  // 6117 外注費 特別処理: 内訳を取引先・摘要で分類し、真の外注のみ outsourcing へ
  if (entry.tkc_code === '6117') {
    const bd = classifyOutsourcingBreakdown(entry)
    drafts.find(d => d.item_code === 'outsourcing')!.amount = bd.other
    return drafts
  }

  // primary がある場合: primary以外は既存値、primary が残額
  if (rule.primary) {
    let sumOthers = 0
    for (const d of drafts) {
      if (d.item_code !== rule.primary) {
        d.amount = d.existing_amount ?? 0
        sumOthers += d.amount
      }
    }
    const p = drafts.find(d => d.item_code === rule.primary)!
    p.amount = Math.max(0, entry.amount_incl - sumOthers)
    return drafts
  }

  // primary 無し: 先頭に全額
  drafts[0].amount = entry.amount_incl
  return drafts
}
