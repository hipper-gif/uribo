/** TKC仕訳帳CSV → うりぼー月次データ 反映CLI
 *
 * ブラウザのTKCインポート画面(pages/TkcImport.tsx)と **同じロジック** を使う。
 * 変換規則の正本は `src/lib/tkcImport.ts`、異常検知の正本は `src/lib/tkcAudit.ts` の1つだけ。
 * このファイルは I/O(CSV読み・DB読み書き・コンソール表示)だけを担い、判定ロジックを持たない。
 * → CLAUDE.md の「TKC連携のイレギュラー運用ルール」を変更したら lib 側を直せば両方に効く。
 *
 * 使い方:
 *   npm run tkc-import -- --csv "C:/Users/nikon/Downloads/仕訳帳.csv"          # dry-run(既定)
 *   npm run tkc-import -- --csv "..." --apply                                  # DBへ反映
 *   npm run tkc-import -- --csv "..." --month 7 --year 2026 --apply --force
 *
 * DB接続は SSH経由 mysql(Xserver)。ブラウザ側APIは Nicolioセッション Cookie 認証のため CLI から使えない。
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  parseJournalCsv, aggregateBeauty, TKC_RULES, buildDraftAssignments,
  classifyOutsourcing, classifyOutsourcingBreakdown,
  type AggregatedEntry, type AssignmentDraft,
} from '../src/lib/tkcImport'
import { auditImport, type AuditFinding } from '../src/lib/tkcAudit'
import { formatAmount, calcDerivedAmount } from '../src/lib/types'
import type { BeautyItemMaster, BeautyMonthlyData, BeautyStore } from '../src/lib/types'

// ── 接続情報(環境変数で上書き可。既定値は uribo/CLAUDE.md 記載の共有値) ──
const SSH_HOST = process.env.URIBO_SSH_HOST ?? 'twinklemark@sv16114.xserver.jp'
const SSH_PORT = process.env.URIBO_SSH_PORT ?? '10022'
const SSH_KEY = process.env.URIBO_SSH_KEY ?? path.join(homedir(), '.ssh', 'id_xserver_panel')
const DB_NAME = process.env.URIBO_DB_NAME ?? 'twinklemark_nicolio'
const DB_USER = process.env.URIBO_DB_USER ?? 'twinklemark_app'
const DB_PASS = process.env.URIBO_DB_PASS ?? 'twinkle2525'

const DATA_TYPE = '実績'

// ═══════════════════ 引数 ═══════════════════

interface Args {
  csv: string
  month?: number
  year?: number
  apply: boolean
  force: boolean
  /** CSVを使わず、DBの現在値から預かり税だけ検算・是正する */
  recalcOnly: boolean
}

function parseArgs(argv: string[]): Args {
  const a: Args = { csv: '', apply: false, force: false, recalcOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--csv') a.csv = argv[++i]
    else if (k === '--month') a.month = Number(argv[++i])
    else if (k === '--year') a.year = Number(argv[++i])
    else if (k === '--apply') a.apply = true
    else if (k === '--force') a.force = true
    else if (k === '--recalc-only') a.recalcOnly = true
    else if (k === '--help' || k === '-h') { usage(); process.exit(0) }
    else throw new Error(`不明な引数: ${k}`)
  }
  if (a.recalcOnly) {
    if (!a.month || !a.year) { usage(); throw new Error('--recalc-only は --year と --month が必須です') }
    return a
  }
  if (!a.csv) { usage(); throw new Error('--csv <仕訳帳CSVのパス> は必須です') }
  return a
}

function usage() {
  console.log(`
TKC仕訳帳CSV → うりぼー反映CLI

  npm run tkc-import -- --csv <path> [--month N] [--year YYYY] [--apply] [--force]

  --csv    TKC仕訳帳CSV(UTF-8)のパス            (必須)
  --month  対象月(省略時はCSVの日付から自動判定・複数月が混在する場合は必須)
  --year   会計年度(省略時はCSVの日付から自動判定。美容は4月始まり)
  --apply  DBへ反映する(既定は dry-run で表示のみ)
  --force  監査の「要対応」があっても反映を強行する

  npm run tkc-import -- --recalc-only --year 2026 --month 6 [--apply]
  --recalc-only  CSVを使わず、DBの現在値から預かり税(=納付税額)だけ検算・是正する
                 (過去にTKC取込だけしてDataEntryで再保存しなかった月の穴埋め)
`)
}

// ═══════════════════ DB I/O (SSH経由 mysql) ═══════════════════

function mysqlExec(sql: string): Promise<string> {
  const remote =
    `mysql -u ${DB_USER} -p${DB_PASS} ${DB_NAME}` +
    ` --batch --raw --skip-column-names --default-character-set=utf8mb4`
  return new Promise((resolve, reject) => {
    const p = spawn('ssh', [
      '-i', SSH_KEY, '-p', SSH_PORT,
      '-o', 'ConnectTimeout=25', '-o', 'BatchMode=yes',
      SSH_HOST, remote,
    ])
    let out = ''
    let err = ''
    p.stdout.setEncoding('utf8')
    p.stderr.setEncoding('utf8')
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => reject(new Error(`ssh起動に失敗: ${e.message}`)))
    p.on('close', code => {
      // mysqlのパスワード警告は無害なので落とす
      const noise = err.split('\n').filter(l => l.trim() && !/Using a password/.test(l)).join('\n')
      if (code !== 0) return reject(new Error(`ssh/mysql 失敗(exit ${code})\n${noise}`))
      if (noise) console.error(noise)
      resolve(out)
    })
    p.stdin.end(sql, 'utf8')
  })
}

/** マーカーで区切った複数クエリの結果を JSON行 の配列群にほどく */
function splitSections(raw: string, markers: string[]): Record<string, string[]> {
  const res: Record<string, string[]> = {}
  let cur = ''
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    if (markers.includes(t)) { cur = t; res[cur] = []; continue }
    if (cur) res[cur].push(t)
  }
  return res
}

interface DbSnapshot {
  items: BeautyItemMaster[]
  history: BeautyMonthlyData[]   // 当年度＋前年度の実績(TkcImport の useMonthlyHistory と同じ範囲)
  stores: BeautyStore[]
}

async function fetchSnapshot(fiscalYear: number): Promise<DbSnapshot> {
  const sql = `
SELECT '@ITEMS';
SELECT JSON_OBJECT('id',id,'item_category',item_category,'item_code',item_code,'item_name',item_name,
  'unit',unit,'is_calculated',is_calculated,'calc_formula',calc_formula,'sort_order',sort_order,'is_active',is_active)
FROM beauty_item_master ORDER BY sort_order;
SELECT '@HISTORY';
SELECT JSON_OBJECT('id',id,'store_id',store_id,'fiscal_year',fiscal_year,'month',month,
  'data_type',data_type,'item_id',item_id,'amount',CAST(amount AS CHAR),'notes',notes)
FROM beauty_monthly_data
WHERE fiscal_year IN (${fiscalYear}, ${fiscalYear - 1}) AND data_type='${DATA_TYPE}';
SELECT '@STORES';
SELECT JSON_OBJECT('id',id,'name',name,'code',code,'is_active',is_active) FROM beauty_stores ORDER BY id;
`
  const raw = await mysqlExec(sql)
  const s = splitSections(raw, ['@ITEMS', '@HISTORY', '@STORES'])
  const parse = <T>(k: string): T[] => (s[k] ?? []).map(l => JSON.parse(l) as T)
  return {
    items: parse<BeautyItemMaster>('@ITEMS'),
    history: parse<BeautyMonthlyData>('@HISTORY'),
    stores: parse<BeautyStore>('@STORES'),
  }
}

// ═══════════════════ プレビュー構築(TkcImport.tsx と同じ流れ) ═══════════════════

interface PreviewRow {
  entry: AggregatedEntry
  drafts: AssignmentDraft[]
  selected: boolean
  unmapped: boolean
  skipped: boolean
}

function buildRows(
  entries: AggregatedEntry[],
  itemByCode: Record<string, { id: number; item_code: string }>,
  existingByStoreItem: Record<string, { id: number; amount: number }>,
): PreviewRow[] {
  return entries.map(e => {
    const rule = TKC_RULES[e.tkc_code]
    const skipped = rule?.skip ?? false
    const unmapped = !rule || (rule.uribo_codes.length === 0 && !skipped)
    const drafts = (!skipped && rule)
      ? buildDraftAssignments({ entry: e, itemByCode, existingByStoreItem, allEntries: entries })
      : []
    return { entry: e, drafts, selected: !skipped && !unmapped, unmapped, skipped }
  })
}

/** 同一(store,item)のdraftを合算(6212従業員給与 + 6117業務委託 → salary_total 等) */
function aggregateDrafts(rows: PreviewRow[]): WriteRow[] {
  const agg = new Map<string, WriteRow>()
  for (const row of rows) {
    if (!row.selected) continue
    for (const d of row.drafts) {
      if (!d.item_id) continue
      const k = `${d.store_id}|${d.item_id}`
      const e = agg.get(k)
      if (e) {
        e.amount += d.amount
        if (e.existing_row_id === null) { e.existing_row_id = d.existing_row_id; e.existing_amount = d.existing_amount }
      } else {
        agg.set(k, {
          store_id: d.store_id, item_id: d.item_id, item_code: d.item_code, amount: d.amount,
          existing_row_id: d.existing_row_id, existing_amount: d.existing_amount,
        })
      }
    }
  }
  return [...agg.values()].sort((a, b) => a.store_id - b.store_id || a.item_code.localeCompare(b.item_code))
}

// ═══════════════════ 派生項目(預かり税)の再計算 ═══════════════════

/** CLIが書き戻す派生item。
 *  ★withholding_tax だけに絞る:
 *    - unit_price は表示側(AnnualView/MonthlyReport/QuarterlyView)が sales/customers から
 *      動的計算するのでDB行は不要
 *    - vat_purchase は「参考行」だが AnnualView 等のカテゴリ合計から除外されていない
 *      (DataEntry だけが REF_ONLY_CODES で除外)。書くと法定費用が二重に膨らむため触らない */
const DERIVED_WRITE_CODES = ['withholding_tax']

interface WriteRow {
  store_id: number
  item_id: number
  item_code: string
  amount: number
  existing_row_id: number | null
  existing_amount: number | null
}

/** TKC反映後の状態から預かり税(=実質の納付税額)を計算し直す。
 *  DataEntry の handleSave と同じ入力集合(is_active=1 の item のみ)で calcDerivedAmount を回す。
 *  TKCインポートは経費(課税仕入)を動かすため、ここを更新しないと預かり税が控除前のまま残り、
 *  純利益が過小に見える(従来は「取込後にDataEntryで開いて再保存」が必要だった)。 */
function buildDerivedWrites(
  storeIds: number[],
  items: BeautyItemMaster[],
  existing: BeautyMonthlyData[],
  tkcWrites: WriteRow[],
  itemById: Map<number, BeautyItemMaster>,
): WriteRow[] {
  const active = items.filter(i => i.is_active === 1)
  const out: WriteRow[] = []
  for (const sid of storeIds) {
    const values: Record<string, number> = {}
    for (const it of active) values[it.item_code] = 0
    for (const d of existing) {
      if (d.store_id !== sid) continue
      const it = itemById.get(d.item_id)
      if (it?.is_active === 1) values[it.item_code] = parseFloat(d.amount) || 0
    }
    for (const w of tkcWrites) {
      if (w.store_id !== sid) continue
      const it = itemById.get(w.item_id)
      if (it?.is_active === 1) values[it.item_code] = w.amount
    }
    for (const code of DERIVED_WRITE_CODES) {
      const it = active.find(i => i.item_code === code)
      if (!it) continue
      const derived = calcDerivedAmount(code, values)
      if (derived === null) continue
      const amount = Math.round(derived)
      const ex = existing.find(d => d.store_id === sid && d.item_id === it.id)
      const exAmt = ex ? parseFloat(ex.amount) : null
      if (exAmt !== null && Math.abs(exAmt - amount) < 1) continue
      out.push({ store_id: sid, item_id: it.id, item_code: code, amount, existing_row_id: ex?.id ?? null, existing_amount: exAmt })
    }
  }
  return out
}

// ═══════════════════ 表示 ═══════════════════

const yen = (n: number) => formatAmount(Math.round(n))
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - width(s)))
const padL = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s
/** 全角を2桁として数える簡易幅計算(コンソール整列用) */
function width(s: string): number {
  let w = 0
  for (const ch of s) w += /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uff60]/.test(ch) ? 2 : 1
  return w
}

function printPreview(rows: PreviewRow[], storeName: (id: number) => string) {
  const byStore = new Map<number, PreviewRow[]>()
  for (const r of rows) {
    if (!byStore.has(r.entry.store_id)) byStore.set(r.entry.store_id, [])
    byStore.get(r.entry.store_id)!.push(r)
  }
  for (const [sid, rs] of [...byStore.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`\n【${storeName(sid)}】`)
    for (const r of rs) {
      const rule = TKC_RULES[r.entry.tkc_code]
      const head = `  ${r.entry.tkc_code} ${pad(r.entry.tkc_name, 12)} TKC ${padL(yen(r.entry.amount_incl), 10)}`
      if (r.skipped) { console.log(`${head}  … 対象外(${rule?.note ?? 'BS科目等'})`); continue }
      if (r.unmapped) { console.log(`${head}  ⚠ 未マッピング(うりぼーitem未定義)`); continue }
      console.log(head)
      for (const d of r.drafts) {
        const cross = d.store_id !== r.entry.store_id ? ` →${storeName(d.store_id)}` : ''
        const ex = d.existing_amount
        const mark = ex === null ? '新規' : Math.abs(ex - d.amount) < 1 ? '変更なし' : `更新 ${ex > d.amount ? '' : '+'}${yen(d.amount - ex)}`
        console.log(`      → ${pad(d.item_code + cross, 20)} 既存 ${padL(ex === null ? '—' : yen(ex), 10)}  反映 ${padL(yen(d.amount), 10)}  [${mark}]`)
      }
      const sum = r.drafts.filter(d => d.store_id === r.entry.store_id).reduce((s, d) => s + d.amount, 0)
      const diff = sum - r.entry.amount_incl
      if (Math.abs(diff) > 1 && r.entry.tkc_code !== '6117' && r.entry.tkc_code !== '6118') {
        console.log(`      ⚠ 振分合計 ${yen(sum)} がTKC値と ${diff > 0 ? '+' : ''}${yen(diff)} ずれています`)
      }
      // 6117は手判断が要るので明細と自動判定を必ず出す
      if (r.entry.tkc_code === '6117') {
        for (const d of r.entry.details) {
          const kind = classifyOutsourcing(d.trader, d.memo, r.entry.store_id, d.amount)
          const label = kind === 'twinkle' ? 'Twinkle代' : kind === 'itaku' ? '業務委託(和田・今道)→salary_total' : 'その他外注→outsourcing'
          console.log(`      · ${d.date.slice(5)} ${pad(d.trader || d.memo || '—', 24)} ${padL(yen(d.amount), 9)}  判定=${label}`)
        }
        const bd = classifyOutsourcingBreakdown(r.entry)
        console.log(`      · 内訳 Twinkle代 ${yen(bd.twinkle)} / 業務委託 ${yen(bd.itaku)} / その他外注 ${yen(bd.other)}`)
      }
    }
  }
}

function printFindings(findings: AuditFinding[], storeName: (id: number) => string) {
  if (findings.length === 0) { console.log('\n【ここおかしくない? チェック】 指摘なし'); return }
  const blocking = findings.filter(f => f.severity === 'blocking')
  console.log(`\n【ここおかしくない? チェック】 要対応 ${blocking.length}件 / 注意 ${findings.length - blocking.length}件`)
  for (const f of findings) {
    const sev = f.severity === 'blocking' ? '要対応' : '注意  '
    const grp = f.group === 'journal' ? '仕訳の疑い' : '取込結果'
    const st = f.storeId === null ? '' : `[${storeName(f.storeId)}] `
    console.log(`  ${sev} ${f.rule} (${grp}) ${st}${f.title}`)
    console.log(`         ${f.detail}`)
  }
}

// ═══════════════════ main ═══════════════════

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.recalcOnly) return runRecalcOnly(args)

  // ── CSV読み込み・対象月の決定 ──
  const text = readFileSync(args.csv, 'utf8')
  const journal = parseJournalCsv(text)
  if (journal.length === 0) throw new Error('仕訳行が検出できませんでした(UTF-8のTKC仕訳帳CSVですか?)')

  const months = [...new Set(journal.map(r => r.month))].sort((a, b) => a - b)
  const month = args.month ?? (months.length === 1 ? months[0] : NaN)
  if (!month || Number.isNaN(month)) {
    throw new Error(`CSVに複数月(${months.join('・')})が含まれます。--month で対象月を指定してください`)
  }
  if (!months.includes(month)) throw new Error(`CSVに${month}月の仕訳がありません(含まれる月: ${months.join('・')})`)

  // 会計年度: 美容は4月始まり。--year 未指定ならCSVの日付から導く
  const sampleYear = Number(journal.find(r => r.month === month)!.date.slice(0, 4))
  const fiscalYear = args.year ?? (month >= 4 ? sampleYear : sampleYear - 1)

  console.log('━━━ TKCインポート ' + (args.apply ? '(反映モード)' : '(dry-run)') + ' ━━━')
  console.log(`CSV : ${args.csv}`)
  console.log(`仕訳: ${journal.length}行 / 対象 ${fiscalYear}年度 ${month}月 ${DATA_TYPE}`)

  // ── DB取得 ──
  const snap = await fetchSnapshot(fiscalYear)
  const storeNameOf = (id: number) => snap.stores.find(s => s.id === id)?.name ?? `店${id}`
  const itemByCode: Record<string, { id: number; item_code: string }> = {}
  for (const it of snap.items) itemByCode[it.item_code] = { id: it.id, item_code: it.item_code }

  const existing = snap.history.filter(d => d.fiscal_year === fiscalYear && d.month === month)
  const existingByStoreItem: Record<string, { id: number; amount: number }> = {}
  for (const d of existing) existingByStoreItem[`${d.store_id}|${d.item_id}`] = { id: d.id, amount: parseFloat(d.amount) }

  // ── プレビュー構築 ──
  const entries = aggregateBeauty(journal, month)
  if (entries.length === 0) throw new Error(`${month}月に美容部門(011/012)の仕訳がありません`)
  const rows = buildRows(entries, itemByCode, existingByStoreItem)
  printPreview(rows, storeNameOf)

  // ── 書き込み内容の組み立て(TKC分 → 派生の再計算) ──
  const itemById = new Map(snap.items.map(i => [i.id, i]))
  const storeIds = (snap.stores.filter(s => s.is_active).map(s => s.id).length
    ? snap.stores.filter(s => s.is_active).map(s => s.id) : [1, 2])
  const tkcWrites = aggregateDrafts(rows).filter(w => !(w.amount === 0 && w.existing_row_id === null))
  const derivedWrites = buildDerivedWrites(storeIds, snap.items, existing, tkcWrites, itemById)
  if (derivedWrites.length) {
    console.log('\n【預かり税の再計算】(取込で課税仕入が変わるため自動更新)')
    for (const w of derivedWrites) {
      console.log(`  ${pad(storeNameOf(w.store_id), 8)} ${pad(w.item_code, 18)} ${padL(w.existing_amount === null ? '—' : yen(w.existing_amount), 10)} → ${padL(yen(w.amount), 10)}`)
    }
  }

  // ── 監査(派生の再計算後の状態で見る。CLIはこの値まで書き込むため) ──
  const auditExisting: BeautyMonthlyData[] = existing.map(d => {
    const dw = derivedWrites.find(w => w.existing_row_id === d.id)
    return dw ? { ...d, amount: String(dw.amount) } : d
  })
  for (const w of derivedWrites) {
    if (w.existing_row_id === null) {
      auditExisting.push({
        id: -1, store_id: w.store_id, fiscal_year: fiscalYear, month,
        data_type: DATA_TYPE, item_id: w.item_id, amount: String(w.amount), notes: null,
      })
    }
  }
  const findings = auditImport({
    rows: rows.map(r => ({ entry: r.entry, drafts: r.drafts, selected: r.selected })),
    journal, existing: auditExisting, history: snap.history, items: snap.items,
    fiscalYear, month, storeIds,
  })
  printFindings(findings, storeNameOf)

  // ── 反映内容の要約 ──
  const writes = [...tkcWrites, ...derivedWrites]
  const changed = writes.filter(w => w.existing_amount === null || Math.abs(w.existing_amount - w.amount) >= 1)
  console.log(`\n【反映内容】 ${writes.length}件(うち値が変わるもの ${changed.length}件)`)
  for (const w of changed) {
    const ex = w.existing_amount
    console.log(`  ${pad(storeNameOf(w.store_id), 8)} ${pad(w.item_code, 18)} ${padL(ex === null ? '—' : yen(ex), 10)} → ${padL(yen(w.amount), 10)}`)
  }

  const blocking = findings.filter(f => f.severity === 'blocking')
  if (!args.apply) {
    console.log('\n(dry-run。反映するには --apply を付けて実行)')
    if (blocking.length) console.log(`※ 要対応 ${blocking.length}件あり。理由を把握した上で反映するなら --force も必要`)
    return
  }
  if (blocking.length && !args.force) {
    throw new Error(`監査の「要対応」が ${blocking.length}件あるため中止しました。内容を確認し、承知の上なら --force を付けてください`)
  }
  if (writes.length === 0) { console.log('\n反映対象がありません'); return }

  await applyWrites(writes, fiscalYear, month)
}

/** UPSERT。UNIQUE(store,fiscal_year,month,data_type,item)があるので何度流しても冪等 */
async function applyWrites(writes: WriteRow[], fiscalYear: number, month: number) {
  const values = writes.map(w =>
    `(${w.store_id},${fiscalYear},${month},'${DATA_TYPE}',${w.item_id},${w.amount.toFixed(2)})`).join(',\n  ')
  const sql = `
INSERT INTO beauty_monthly_data (store_id, fiscal_year, month, data_type, item_id, amount)
VALUES
  ${values}
ON DUPLICATE KEY UPDATE amount=VALUES(amount);
SELECT ROW_COUNT();
`
  await mysqlExec(sql)
  console.log(`\n✅ ${writes.length}件を うりぼー(${DB_NAME}.beauty_monthly_data) に反映しました`)
  console.log('   確認: https://twinklemark.xsrv.jp/uribo/')
}

/** --recalc-only: CSVを使わず、DBの現在値だけで預かり税を検算する。
 *  TKC取込だけして DataEntry で再保存しなかった月は、預かり税が仕入控除前のまま残っている。 */
async function runRecalcOnly(args: Args) {
  const fiscalYear = args.year!
  const month = args.month!
  console.log(`━━━ 預かり税の検算 ${fiscalYear}年度 ${month}月 ` + (args.apply ? '(是正モード)' : '(dry-run)') + ' ━━━')

  const snap = await fetchSnapshot(fiscalYear)
  const storeNameOf = (id: number) => snap.stores.find(s => s.id === id)?.name ?? `店${id}`
  const itemById = new Map(snap.items.map(i => [i.id, i]))
  const existing = snap.history.filter(d => d.fiscal_year === fiscalYear && d.month === month)
  if (existing.length === 0) throw new Error(`${fiscalYear}年度${month}月の実績データがありません`)
  const storeIds = snap.stores.filter(s => s.is_active).map(s => s.id)

  const writes = buildDerivedWrites(storeIds.length ? storeIds : [1, 2], snap.items, existing, [], itemById)
  if (writes.length === 0) { console.log('\n差分なし(預かり税は現在値で正しい)'); return }
  for (const w of writes) {
    const ex = w.existing_amount
    console.log(`  ${pad(storeNameOf(w.store_id), 8)} ${pad(w.item_code, 18)} ${padL(ex === null ? '—' : yen(ex), 10)} → ${padL(yen(w.amount), 10)}  (差 ${yen(w.amount - (ex ?? 0))})`)
  }
  if (!args.apply) { console.log('\n(dry-run。是正するには --apply を付けて実行)'); return }
  await applyWrites(writes, fiscalYear, month)
}

main().catch(e => {
  console.error('\n❌ ' + (e as Error).message)
  process.exit(1)
})
