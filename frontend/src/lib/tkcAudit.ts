/** TKCインポート 異常検知（「ここおかしくない?」ゲート）
 *
 * 2系統の検知を1パスで行う:
 *  ① 取込結果の疑い (R系): 反映後のうりぼーデータが履歴から見て不自然か
 *     R1 経常費の欠落 / R5 按分値の範囲外 / R7 カテゴリ前月比乖離 / R18 親子合算ズレ
 *  ② 仕訳そのものの疑い (J系): TKC側の科目付け・計上が間違っていそうか
 *     J1 重複計上 / J2 摘要↔科目の不一致 / J3 美容取引の部門漏れ(取込すり抜け)
 *
 * すべて純粋関数。しきい値は AUDIT_THRESHOLDS に集約(調整は1箇所)。
 */
import type { BeautyItemMaster, BeautyMonthlyData, ItemCategory } from './types'
import { EXPENSE_CATEGORIES, calcDerivedAmount } from './types'
import type { AggregatedEntry, AssignmentDraft, ParsedJournalRowWithTrader } from './tkcImport'
import { TKC_DEPT_TO_STORE } from './tkcImport'

export type Severity = 'blocking' | 'warning'

export interface AuditFinding {
  rule: string
  severity: Severity
  /** 'data' = 取込結果の疑い / 'journal' = 仕訳そのものの疑い */
  group: 'data' | 'journal'
  storeId: number | null
  title: string
  detail: string
}

export const AUDIT_THRESHOLDS = {
  /** R1: 経常費とみなすカテゴリ(毎月ほぼ出るはず) */
  recurringCategories: ['契約固定費', 'サブスク', 'インフラ', '管理費'] as ItemCategory[],
  /** R1: 直近Nヶ月のうちM回以上 >0 なら「経常」と判定 */
  recurringLookback: 3,
  recurringMinHits: 2,
  /** R1: 欠落時、過去中央値がこの額以上なら blocking、未満は warning */
  missingBlockingFloor: 30000,
  /** R5: 範囲外チェック対象(按分・半固定で値が安定しているはずのitem) */
  stableCodes: ['twinkle_fee'] as string[],
  r5RangeLow: 0.8,   // 過去min × 0.8
  r5RangeHigh: 1.2,  // 過去max × 1.2
  r5PrevDelta: 0.2,  // かつ前月比±20%超なら異常
  /** R7: カテゴリ別 前月比の許容乖離率 */
  categoryDelta: {
    '変動費': 0.30, '人件費': 0.15, '法定費用': 0.10, '契約固定費': 0.05,
    'インフラ': 0.15, 'サブスク': 0.10, 'スポット費用': 0.50, '管理費': 0.20,
    'その他': 0.30, '売上': 0.30,
  } as Record<string, number>,
  /** R7: 前月カテゴリ合計がこの額未満なら判定しない(少額のノイズ回避) */
  categoryFloor: 5000,
  /** R18: 親子合算ズレの許容(円 と 比率の両方を超えたら警告) */
  r18AbsTol: 1000,
  r18PctTol: 0.05,
  /** R21: 派生計算(預かり税/仕入消費税)の再計算照合 許容(円) */
  derivedTol: 500,
  /** R21: 再計算照合する派生item */
  derivedCodes: ['withholding_tax', 'vat_purchase'] as string[],
} as const

/** 会計月の絶対インデックス(美容は4月始まり。1〜3月は翌年扱い) */
function calAbs(fy: number, m: number): number {
  return (m >= 4 ? fy : fy + 1) * 12 + (m - 1)
}

/** 仕訳間違いの手がかり: 摘要キーワード → あるべきTKC科目候補 */
const MEMO_EXPECTED: { re: RegExp; codes: string[]; label: string }[] = [
  { re: /水道/, codes: ['6219'], label: '水道代' },
  { re: /駐車|交通費/, codes: ['6111', '6112'], label: '交通費' },
  { re: /家賃|地代/, codes: ['6215'], label: '家賃' },
  { re: /電気|電力/, codes: ['6219'], label: '電気代' },
  { re: /電話|回線|通信/, codes: ['6218'], label: '通信費' },
]

/** 美容に関係しそうな取引先(部門漏れ検知用)。摘要の店名と併せて使う */
const BEAUTY_VENDOR_RE = /リジョブ|ホットペッパー|ﾎｯﾄﾍﾟｯﾊﾟｰ|hpb|ビューティガレージ|キャンアイドレッシー|富士山|銘水/i
// ★「寝屋川/守口」単体は介護の地名(寝屋川市障害福祉・訪問介護連絡会 等)にも出て誤検知するため、
//   「店」付き or 「美容」に限定(2026-06 年次仕訳で誤検知4件中3件が介護地名と判明)
const BEAUTY_MEMO_RE = /寝屋川店|守口店|美容/

export interface AuditInput {
  rows: { entry: AggregatedEntry; drafts: AssignmentDraft[]; selected: boolean }[]
  journal: ParsedJournalRowWithTrader[]
  /** 対象月の既存実績行 */
  existing: BeautyMonthlyData[]
  /** 実績の履歴(対象月より前の月を含む。全店) */
  history: BeautyMonthlyData[]
  items: BeautyItemMaster[]
  fiscalYear: number
  month: number
  storeIds: number[]
}

export function auditImport(input: AuditInput): AuditFinding[] {
  const { rows, journal, existing, history, items, fiscalYear, month, storeIds } = input
  const findings: AuditFinding[] = []
  const targetAbs = calAbs(fiscalYear, month)

  const itemById = new Map<number, BeautyItemMaster>()
  const itemByCode = new Map<string, BeautyItemMaster>()
  for (const it of items) { itemById.set(it.id, it); itemByCode.set(it.item_code, it) }
  const storeName = (sid: number) => sid === 1 ? '寝屋川店' : sid === 2 ? '守口店' : `店${sid}`

  // ── 履歴を (store|code) -> [{abs, amount}] (対象月より前) に整形 ──
  const series = new Map<string, { abs: number; amount: number }[]>()
  for (const r of history) {
    const it = itemById.get(r.item_id)
    if (!it) continue
    const abs = calAbs(r.fiscal_year, r.month)
    if (abs >= targetAbs) continue
    const key = `${r.store_id}|${it.item_code}`
    const amt = parseFloat(r.amount) || 0
    if (!series.has(key)) series.set(key, [])
    series.get(key)!.push({ abs, amount: amt })
  }
  const at = (store: number, code: string, abs: number) =>
    series.get(`${store}|${code}`)?.find(p => p.abs === abs)?.amount ?? null
  const prevOf = (store: number, code: string) => at(store, code, targetAbs - 1)
  const recentHits = (store: number, code: string, n: number) => {
    const arr = (series.get(`${store}|${code}`) ?? []).filter(p => p.abs >= targetAbs - n && p.abs < targetAbs && p.amount > 0)
    return arr.map(p => p.amount)
  }
  const last12 = (store: number, code: string) =>
    (series.get(`${store}|${code}`) ?? []).filter(p => p.abs >= targetAbs - 12 && p.abs < targetAbs && p.amount > 0).map(p => p.amount)
  const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

  // ── 反映後の状態 result[store][code] = 金額 を構築 ──
  // 既存値をベースに、importが触れるitemは draft合算値で上書き
  // (同一(store,code)に複数draftが来る場合は合算: 例 6212給与 + 6117和田 → salary_total)
  const result = new Map<string, number>()       // key store|code
  for (const r of existing) {
    const it = itemById.get(r.item_id)
    if (it) result.set(`${r.store_id}|${it.item_code}`, parseFloat(r.amount) || 0)
  }
  const draftSum = new Map<string, number>()
  for (const row of rows) {
    if (!row.selected) continue
    for (const d of row.drafts) {
      const k = `${d.store_id}|${d.item_code}`
      draftSum.set(k, (draftSum.get(k) ?? 0) + d.amount)
    }
  }
  for (const [k, v] of draftSum) result.set(k, v)
  const resultAmt = (store: number, code: string) => result.get(`${store}|${code}`) ?? null

  // ════════ ① 取込結果の疑い ════════

  // R1: 経常費の欠落
  for (const sid of storeIds) {
    for (const it of items) {
      if (!it.is_active) continue
      if (!AUDIT_THRESHOLDS.recurringCategories.includes(it.item_category)) continue
      const hits = recentHits(sid, it.item_code, AUDIT_THRESHOLDS.recurringLookback)
      if (hits.length < AUDIT_THRESHOLDS.recurringMinHits) continue
      const now = resultAmt(sid, it.item_code)
      if (now !== null && now > 0) continue
      const typical = median(hits)
      const sev: Severity = typical >= AUDIT_THRESHOLDS.missingBlockingFloor ? 'blocking' : 'warning'
      findings.push({
        rule: 'R1', severity: sev, group: 'data', storeId: sid,
        title: `${it.item_name}(${it.item_category})が今月0/未計上`,
        detail: `${storeName(sid)}: 直近${AUDIT_THRESHOLDS.recurringLookback}ヶ月で${hits.length}回計上(目安 ${Math.round(typical).toLocaleString()}円)あるのに、今月は反映後0円。経常費の取りこぼし or 仕訳の部門漏れの疑い。`,
      })
    }
  }

  // R5: 按分・半固定itemの範囲外
  for (const sid of storeIds) {
    for (const code of AUDIT_THRESHOLDS.stableCodes) {
      const now = resultAmt(sid, code)
      if (now === null) continue
      const hist = last12(sid, code)
      if (hist.length < 2) continue
      const lo = Math.min(...hist) * AUDIT_THRESHOLDS.r5RangeLow
      const hi = Math.max(...hist) * AUDIT_THRESHOLDS.r5RangeHigh
      const prev = prevOf(sid, code) ?? 0
      const outRange = now < lo || now > hi
      const bigDelta = prev > 0 && Math.abs(now - prev) / prev > AUDIT_THRESHOLDS.r5PrevDelta
      if (outRange && bigDelta) {
        const it = itemByCode.get(code)
        findings.push({
          rule: 'R5', severity: 'blocking', group: 'data', storeId: sid,
          title: `${it?.item_name ?? code}が想定レンジ外`,
          detail: `${storeName(sid)}: 今月 ${now.toLocaleString()}円。過去12ヶ月レンジ ${Math.round(lo).toLocaleString()}〜${Math.round(hi).toLocaleString()}円、前月 ${prev.toLocaleString()}円から外れています。按分計算ミス or 二重計上の疑い。`,
        })
      }
    }
  }

  // R7: カテゴリ別 前月比乖離
  for (const sid of storeIds) {
    const catNow = new Map<string, number>()
    const catPrev = new Map<string, number>()
    for (const it of items) {
      if (!it.is_active) continue
      const now = resultAmt(sid, it.item_code) ?? 0
      const prev = prevOf(sid, it.item_code) ?? 0
      catNow.set(it.item_category, (catNow.get(it.item_category) ?? 0) + now)
      catPrev.set(it.item_category, (catPrev.get(it.item_category) ?? 0) + prev)
    }
    for (const [cat, prev] of catPrev) {
      if (prev < AUDIT_THRESHOLDS.categoryFloor) continue
      const now = catNow.get(cat) ?? 0
      const tol = AUDIT_THRESHOLDS.categoryDelta[cat] ?? 0.3
      const delta = (now - prev) / prev
      if (Math.abs(delta) > tol) {
        findings.push({
          rule: 'R7', severity: 'warning', group: 'data', storeId: sid,
          title: `${cat}が前月比 ${(delta * 100 >= 0 ? '+' : '')}${(delta * 100).toFixed(0)}%`,
          detail: `${storeName(sid)} ${cat}: 前月 ${Math.round(prev).toLocaleString()}円 → 今月 ${Math.round(now).toLocaleString()}円(許容±${(tol * 100).toFixed(0)}%超)。`,
        })
      }
    }
  }

  // R18: 親子合算ズレ(TKC親科目の額 vs 振分先itemの合計)。6117/6118はクロス店舗按分のため除外
  for (const row of rows) {
    if (!row.selected) continue
    if (row.entry.tkc_code === '6117' || row.entry.tkc_code === '6118') continue
    const sumSameStore = row.drafts.filter(d => d.store_id === row.entry.store_id).reduce((s, d) => s + d.amount, 0)
    const diff = sumSameStore - row.entry.amount_incl
    const pct = row.entry.amount_incl ? Math.abs(diff) / row.entry.amount_incl : 0
    if (Math.abs(diff) > AUDIT_THRESHOLDS.r18AbsTol && pct > AUDIT_THRESHOLDS.r18PctTol) {
      findings.push({
        rule: 'R18', severity: 'warning', group: 'data', storeId: row.entry.store_id,
        title: `TKC ${row.entry.tkc_code} ${row.entry.tkc_name} の振分合計が不一致`,
        detail: `${storeName(row.entry.store_id)}: TKC ${row.entry.amount_incl.toLocaleString()}円に対し振分先合計 ${sumSameStore.toLocaleString()}円(差 ${diff >= 0 ? '+' : ''}${diff.toLocaleString()}円)。細目の振り分け漏れの疑い。`,
      })
    }
  }

  // R21: 内部整合 — 派生計算(預かり税/仕入消費税)の再計算照合
  // 反映後の値マップを store ごとに組み、calcDerivedAmount の結果と保存値を突き合わせる
  const valuesByStore = new Map<number, Record<string, number>>()
  for (const [k, amt] of result) {
    const sep = k.indexOf('|')
    const sid = Number(k.slice(0, sep))
    const code = k.slice(sep + 1)
    if (!valuesByStore.has(sid)) valuesByStore.set(sid, {})
    valuesByStore.get(sid)![code] = amt
  }
  for (const sid of storeIds) {
    const values = valuesByStore.get(sid)
    if (!values) continue
    for (const code of AUDIT_THRESHOLDS.derivedCodes) {
      const stored = values[code]
      if (stored === undefined) continue
      const recalc = calcDerivedAmount(code, values)
      if (recalc === null) continue
      if (Math.abs(stored - recalc) > AUDIT_THRESHOLDS.derivedTol) {
        const it = itemByCode.get(code)
        findings.push({
          rule: 'R21', severity: 'warning', group: 'data', storeId: sid,
          title: `${it?.item_name ?? code}が再計算値とズレ`,
          detail: `${storeName(sid)}: 保存値 ${Math.round(stored).toLocaleString()}円 / 再計算 ${recalc.toLocaleString()}円(差 ${Math.round(stored - recalc).toLocaleString()}円)。取込で課税仕入が変わった場合はDataEntryで再保存すると自動再計算されます(預かり税は保存時計算)。`,
        })
      }
    }
  }

  // R22: マスタ整合 — item_category が9区分(+売上)の許容集合か(ENUM事故/全寄せ対策)
  const validCats = new Set<string>([...EXPENSE_CATEGORIES, '売上'])
  for (const it of items) {
    if (!it.is_active) continue
    const cat = (it.item_category ?? '').trim()
    if (!cat || !validCats.has(cat)) {
      findings.push({
        rule: 'R22', severity: 'blocking', group: 'data', storeId: null,
        title: `項目「${it.item_name}」のカテゴリが不正(${cat || '空'})`,
        detail: `item_code=${it.item_code} の item_category が9区分のいずれでもありません(${cat || '空文字'})。ENUM事故等でマスタが壊れた可能性。このままだとダッシュボード集計から漏れます。`,
      })
    }
  }

  // ════════ ② 仕訳そのものの疑い ════════

  // J1: 重複計上(同一店舗×同一取引先×同額が同月に複数) — entry.detailsベース
  for (const row of rows) {
    const byKey = new Map<string, { count: number; amount: number; trader: string; dates: string[] }>()
    for (const d of row.entry.details) {
      const trader = (d.trader || '').trim()
      if (!trader) continue
      const k = `${trader}|${d.amount}`
      const e = byKey.get(k) ?? { count: 0, amount: d.amount, trader, dates: [] }
      e.count++; e.dates.push(d.date.slice(5))
      byKey.set(k, e)
    }
    for (const e of byKey.values()) {
      if (e.count >= 2 && e.amount > 0) {
        findings.push({
          rule: 'J1', severity: 'warning', group: 'journal', storeId: row.entry.store_id,
          title: `重複計上の疑い: ${e.trader} ${e.amount.toLocaleString()}円 ×${e.count}`,
          detail: `${storeName(row.entry.store_id)} TKC ${row.entry.tkc_code} ${row.entry.tkc_name}: 同じ取引先・同額が${e.count}回(${e.dates.join('・')})。二重計上 or まとめ計上か確認。`,
        })
      }
    }
  }

  // J2 / J3: 仕訳行を直接走査
  for (const r of journal) {
    const isExpense = /^[56]/.test(r.debit_code)
    if (!isExpense) continue
    const dept = r.debit_dept
    const beautyStore = TKC_DEPT_TO_STORE[dept]
    const blob = `${r.trader} ${r.memo}`

    // J2: 摘要↔科目の不一致(美容部門の仕訳のみ)
    if (beautyStore) {
      for (const rule of MEMO_EXPECTED) {
        if (rule.re.test(r.memo) && !rule.codes.includes(r.debit_code)) {
          findings.push({
            rule: 'J2', severity: 'warning', group: 'journal', storeId: beautyStore.storeId,
            title: `摘要「${rule.label}」だが科目=${r.debit_code} ${r.debit_name}`,
            detail: `${storeName(beautyStore.storeId)} ${r.date.slice(5)} ${r.trader || ''} ${r.memo} ${r.debit_incl.toLocaleString()}円。${rule.label}なら通常 ${rule.codes.join('/')} のはず。仕訳の科目誤りの疑い。`,
          })
          break
        }
      }
    }

    // J3: 美容っぽい取引なのに部門が美容(011/012)でない → 取込から漏れる
    if (!beautyStore) {
      const looksBeauty = BEAUTY_VENDOR_RE.test(blob) || BEAUTY_MEMO_RE.test(r.memo)
      if (looksBeauty) {
        findings.push({
          rule: 'J3', severity: 'warning', group: 'journal', storeId: null,
          title: `美容の取引かも? だが部門=${dept || '(未設定)'}`,
          detail: `${r.date.slice(5)} ${r.trader || ''} ${r.memo} (${r.debit_code} ${r.debit_name}) ${r.debit_incl.toLocaleString()}円。部門が011/012でないため、うりぼーに取り込まれません。美容の費用なら部門の付け間違いの疑い(HPB漏れと同型)。`,
        })
      }
    }
  }

  // 重大度→グループの順でソート
  const sevRank = { blocking: 0, warning: 1 }
  return findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.group.localeCompare(b.group) || (a.storeId ?? 9) - (b.storeId ?? 9))
}
