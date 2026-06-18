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
  // ★和田判定を先に: TKC上、和田委託費も取引先が "Twinkle" 名義になることがあるため、
  //   「和田」と明記された行は Twinkle名義でも和田委託費(salary_total済→取込対象外)に倒す。
  //   (経緯: 2026/05 守口の "Twinkle 委託販売手数料 65,000" が実は和田委託で、Twinkle代と誤判定された)
  if (/ワダ|和田|ﾜﾀﾞ|wada/i.test(s)) return 'wada'
  // 「テインクル」「ティンクル」「twinkle」「スギハラ」「杉原」「ソウカ」「爽夏」を含むなら Twinkle代
  if (/テインクル|ティンクル|ﾃｲﾝｸﾙ|twinkle|スギハラ|杉原|ｽｷﾞﾊﾗ|ソウカ|爽夏|ｿｳｶ/i.test(trader + memo)) return 'twinkle'
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
  '6113': { name: '広告宣伝費', uribo_codes: ['hpb', 'advertising'], primary: 'advertising', note: 'HPB(月額固定)は既存値維持、HPB以外を advertising へ' },
  '6116': { name: '採用教育費', uribo_codes: ['training', 'recruitment'], primary: 'recruitment' },
  '6117': { name: '外注費', uribo_codes: ['outsourcing'], note: '★Twinkle代(介護按分前)+和田委託費が混入。Twinkle代は(TKC-40,000)÷2を各店舗twinkle_feeへ' },
  '6118': { name: 'ロイヤルティ', uribo_codes: ['franchise_fee'] },
  '6212': { name: '従業員給与', uribo_codes: ['salary_total'] },
  '6214': { name: '減価償却費', uribo_codes: [], skip: true, note: '非現金費用のためうりぼうではキャッシュ視点で計上しない' },
  '6215': { name: '地代家賃', uribo_codes: ['rent'], note: '寝屋川店は請求124k=家賃121k+水道3k分離。要確認' },
  '6216': { name: '修繕費', uribo_codes: ['repair'] },
  '6218': { name: '通信費', uribo_codes: ['microsoft', 'spotify', 'amazon_prime', 'communication'], primary: 'communication', note: 'サブスク既存値を維持、電話/ネット等を communication へ' },
  '6219': { name: '水道光熱費', uribo_codes: ['water_utility', 'water_supply', 'electricity', 'gas'], primary: 'electricity', note: '水道既存値を維持、電気/ガスを別途' },
  '6223': { name: '接待交際費', uribo_codes: ['entertainment'] },
  '6224': { name: '保険料', uribo_codes: ['insurance'] },
  '6225': { name: '備品消耗品費', uribo_codes: ['supplies'] },
  '6226': { name: '福利厚生費', uribo_codes: ['water_supply'], note: '美容部門の6226はほぼウォーターサーバー(富士山の天然水)のため water_supply に充当' },
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
  /** 全集計エントリ(6117 Twinkle代を全店舗合算して按分するため必要) */
  allEntries: AggregatedEntry[]
}

/** 親TKC科目に複数のうりぼーitemが混在する場合の、取引先名/摘要による明細単位の細分ルール。
 *  classifyOutsourcing と同じ発想を 6218/6219/6226/6227/6113 へ横展開。
 *  返り値の item_code が itemByCode に無ければ呼び出し側が primary へフォールバックする。
 *  ★これが無いと「6218通信費の中のサブスク(microsoft/spotify/amazon_prime)」「6227の中のゴミ回収」
 *    「6219の中の水道」「6226の中の非ウォーター福利厚生」が primary に全寄せされ、細目itemが消える。 */
export const TKC_SUBCLASSIFIERS: Record<string, (trader: string, memo: string) => string> = {
  // 通信費: サブスクを取引先名で分離、残りは communication
  '6218': (t, m) => {
    const s = t + m
    if (/マイクロソフト|microsoft|ﾏｲｸﾛｿﾌﾄ/i.test(s)) return 'microsoft'
    if (/スポティファイ|spotify|ｽﾎﾟﾃｨﾌｧｲ/i.test(s)) return 'spotify'
    if (/アマゾン|amazon|ｱﾏｿﾞﾝ/i.test(s)) return 'amazon_prime'
    return 'communication'
  },
  // 水道光熱費: 水道/ガスを分離、残りは電気
  '6219': (t, m) => {
    const s = t + m
    if (/水道/.test(s)) return 'water_utility'
    if (/ガス|ｶﾞｽ|\bgas\b/i.test(s)) return 'gas'
    return 'electricity'
  },
  // 福利厚生費: ウォーターサーバー(富士山の銘水)は water_supply、それ以外は welfare(本来の福利厚生)
  '6226': (t, m) => {
    const s = t + m
    if (/富士山|銘水|ウォーター|water/i.test(s)) return 'water_supply'
    return 'welfare'
  },
  // 支払手数料: ゴミ回収は garbage、残りは fees
  '6227': (t, m) => {
    const s = t + m
    if (/ゴミ|ごみ|塵芥|清掃/.test(s)) return 'garbage'
    return 'fees'
  },
  // 広告宣伝費: HPB(ホットペッパー/リクルート)は hpb、それ以外(リジョブ等)は advertising
  '6113': (t, m) => {
    const s = t + m
    // 「リクルートペイメント手数料」は6227側なのでここには来ない
    if (/ホットペッパー|ﾎｯﾄﾍﾟｯﾊﾟｰ|hot ?pepper|hpb|リクルート|ﾘｸﾙｰﾄ/i.test(s)) return 'hpb'
    return 'advertising'
  },
}

export function buildDraftAssignments(input: DraftBuilderInput): AssignmentDraft[] {
  const { entry, itemByCode, existingByStoreItem, allEntries } = input
  const rule = TKC_RULES[entry.tkc_code]
  if (!rule || rule.skip || rule.uribo_codes.length === 0) return []

  const mkDraft = (storeId: number, code: string, amount: number): AssignmentDraft | null => {
    const it = itemByCode[code]
    if (!it) return null
    const ex = existingByStoreItem[`${storeId}|${it.id}`]
    return {
      tkc_code: entry.tkc_code,
      store_id: storeId,
      item_code: code,
      item_id: it.id,
      amount: Math.round(amount),
      existing_amount: ex?.amount ?? null,
      existing_row_id: ex?.id ?? null,
    }
  }

  // 6117 外注費 特別処理(細分判定より前):
  //  Twinkle代: 全6117エントリ(両店舗)を合算 →(合計 − 40,000介護按分)÷2 を各店舗 twinkle_fee へ。
  //    ★店舗ごとに按分すると、6117が複数店舗に分割計上されたとき(2026/05: 寝屋川170k+守口65k)
  //      互いに上書きして過小になるバグがあった。合算してから1回だけ生成する。
  //  和田委託費: うりぼー側はsalary_totalに含むため無視。
  //  その他: outsourcing へ(店舗別)。
  if (entry.tkc_code === '6117') {
    const drafts: AssignmentDraft[] = []
    const bd = classifyOutsourcingBreakdown(entry)
    const out = mkDraft(entry.store_id, 'outsourcing', bd.other)
    if (out) drafts.push(out)

    // 全6117エントリのうち最小store_idのエントリでのみ Twinkle代を生成(重複防止)
    const sixEntries = allEntries.filter(e => e.tkc_code === '6117')
    const isPrimaryEntry = sixEntries.every(e => e.store_id >= entry.store_id)
    if (isPrimaryEntry) {
      const totalTwinkle = sixEntries.reduce((s, e) => s + classifyOutsourcingBreakdown(e).twinkle, 0)
      if (totalTwinkle > 0) {
        const KAIGO_DEDUCT = 40000
        const perStore = Math.max(0, totalTwinkle - KAIGO_DEDUCT) / 2
        for (const sid of [1, 2]) {
          const tw = mkDraft(sid, 'twinkle_fee', perStore)
          if (tw) drafts.push(tw)
        }
      }
    }
    return drafts
  }

  // 取引先名による明細単位の細分(6218/6219/6226/6227/6113):
  //  各仕訳明細を分類器でうりぼーitemへ振り分け、合算する。
  //  分類器の返り値itemが存在しなければ primary(なければ先頭) へフォールバック。
  const classifier = TKC_SUBCLASSIFIERS[entry.tkc_code]
  if (classifier) {
    const fallback = rule.primary ?? rule.uribo_codes[0]
    const byCode: Record<string, number> = {}
    for (const d of entry.details) {
      let code = classifier(d.trader, d.memo)
      if (!itemByCode[code]) code = fallback
      byCode[code] = (byCode[code] ?? 0) + d.amount
    }
    const drafts: AssignmentDraft[] = []
    for (const [code, amt] of Object.entries(byCode)) {
      const d = mkDraft(entry.store_id, code, amt)
      if (d) drafts.push(d)
    }
    return drafts
  }

  const codes = rule.uribo_codes.filter(c => itemByCode[c])
  if (codes.length === 0) return []

  // 単一item: 全額
  if (codes.length === 1) {
    const d = mkDraft(entry.store_id, codes[0], entry.amount_incl)
    return d ? [d] : []
  }

  // primary がある場合: primary以外は既存値を維持、primary が残額
  if (rule.primary) {
    const drafts: AssignmentDraft[] = []
    let sumOthers = 0
    for (const code of codes) {
      if (code === rule.primary) continue
      const ex = existingByStoreItem[`${entry.store_id}|${itemByCode[code].id}`]
      const amt = ex?.amount ?? 0
      sumOthers += amt
      const d = mkDraft(entry.store_id, code, amt)
      if (d) drafts.push(d)
    }
    const p = mkDraft(entry.store_id, rule.primary, Math.max(0, entry.amount_incl - sumOthers))
    if (p) drafts.unshift(p)
    return drafts
  }

  // primary 無し: 先頭に全額
  const d = mkDraft(entry.store_id, codes[0], entry.amount_incl)
  return d ? [d] : []
}
