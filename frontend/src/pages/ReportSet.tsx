/**
 * 報告セット（2026-10-15 新設）
 * 年度と月（または半期）を選ぶと、会議で配る数枚を印刷用に並べる。「印刷」1回で全部刷れる。
 *
 * 数字の定義（FY2026 半期報告で経営に出したものと同じ。うりぼーの他の画面の「純利益」とは定義が違う）:
 *   純利益 = 売上（割引前）− 割引 − 経費 − 減価償却 6.4万円/月・店。消費税の預かり・納付は別枠（含めない）
 *   経費（割引込み）= 売上 − 純利益
 *   部門計 = 店ごとの値を 0.1万円 で丸めてから足す（報告書の 138.5＋27.1＝165.6 と揃えるため）
 * 目標の版:
 *   期初目標 = data_type「目標」（期初に登録したもの・上書きしない）
 *   見通し   = data_type「見通し」（何も変えなければこうなる、という予測）
 *   下期修正 = data_type「目標修正」（期中の見直し。無い月は期初目標をそのまま使う）
 */
import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear } from '../lib/types'

const DEP = 6.4e4
const STORES = [{ id: 1, name: '寝屋川店' }, { id: 2, name: '守口店' }] as const
const EXCL = new Set(['sales', 'customers', 'unit_price', 'withholding_tax', 'vat_purchase', 'net_payable_tax', 'other_expense',
  'total_expense', 'net_profit', 'profit_rate', 'health_ins_total', 'depreciation'])
const PAY = ['cash_', 'card_', 'ic_', 'gift_', 'point_', 'other_payment']

// 科目のまとめ方（半期報告の損益表と同じ）
const GROUPS: { head: string; rows: { name: string; codes: string[] | 'DEP' }[] }[] = [
  { head: '人件費', rows: [
    { name: '給与・交通費・福利厚生', codes: ['salary_total', 'transport_total', 'commute_allowance', 'welfare', 'training'] },
    { name: '賞与', codes: ['bonus'] },
    { name: '法定福利費（社保の会社負担）', codes: ['legal_welfare', 'workers_comp'] },
  ] },
  { head: '店の固定費', rows: [
    { name: '家賃・商店街・加盟金・保険', codes: ['rent', 'shopping_street', 'franchise_fee', 'insurance'] },
    { name: 'HPB掲載料', codes: ['hpb'] },
    { name: 'Twinkle管理料', codes: ['twinkle_fee'] },
    { name: '減価償却', codes: 'DEP' },
  ] },
  { head: '変動費・その他', rows: [
    { name: '仕入・備品・決済手数料', codes: ['cogs', 'supplies', 'fees'] },
    { name: '水道光熱・通信・サブスク', codes: ['water_supply', 'water_utility', 'electricity', 'gas', 'communication', 'garbage', 'microsoft', 'spotify', 'amazon_prime'] },
    { name: '広告・求人・外注・出張ほか', codes: ['advertising', 'recruitment', 'travel_expense', 'outsourcing', 'repair', 'entertainment', 'meeting'] },
  ] },
]

type Vals = Record<string, number>
type Key = 'act' | 'ly' | 'init' | 'fc' | 'rev'
type StoreData = Record<Key, Record<number, Vals>>
type Mode = 'month' | 'half'
type PlanVer = 'init' | 'rev'

const DT: Record<Key, [string, number]> = { act: ['実績', 0], ly: ['実績', -1], init: ['目標', 0], fc: ['見通し', 0], rev: ['目標修正', 0] }

async function fetchKey(itemCode: Record<number, string>, store: number, fy: number, key: Key): Promise<Record<number, Vals>> {
  const [dt, off] = DT[key]
  const out: Record<number, Vals> = {}
  const add = (rows: { month: number; item_id: number; amount: string }[]) => {
    for (const r of rows) {
      const c = itemCode[r.item_id]
      if (!c) continue
      const m = (out[r.month] ??= {})
      m[c] = (m[c] ?? 0) + Number(r.amount)
    }
  }
  const base = { select: 'month,item_id,amount', store_id: `eq.${store}`, fiscal_year: `eq.${fy + off}`, data_type: `eq.${dt}` }
  // API は1回1000行まで。上限に当たったら月ごとに取り直す
  const r = await apiGet<{ month: number; item_id: number; amount: string }[]>('beauty_monthly_data', base)
  if (r.data && r.data.length < 1000) { add(r.data); return out }
  for (const m of FISCAL_MONTHS) {
    const rm = await apiGet<{ month: number; item_id: number; amount: string }[]>('beauty_monthly_data', { ...base, month: `eq.${m}` })
    if (rm.data) add(rm.data)
  }
  return out
}

/** 1か月分の損益。売上が無ければ null */
function pl(v?: Vals) {
  if (!v || !v.sales) return null
  let exp = 0
  for (const [k, a] of Object.entries(v)) {
    if (EXCL.has(k) || k === 'discount' || PAY.some(p => k.startsWith(p))) continue
    exp += a
  }
  const profit = v.sales - (v.discount ?? 0) - exp - DEP
  return { sales: v.sales, profit, cost: v.sales - profit }
}
function groupVal(v: Vals | undefined, codes: string[] | 'DEP') {
  if (!v || !v.sales) return null
  return codes === 'DEP' ? DEP : codes.reduce((s, c) => s + (v[c] ?? 0), 0)
}

const r1 = (x: number) => Math.round(x / 1000 + 1e-9) / 10           // 円 → 万円（0.1万で丸め）
const fmt = (x: number | null | undefined, d = 1) => x == null ? '—' : (x < 0 ? '−' : '') + Math.abs(x).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d })
const pctTxt = (a: number | null | undefined, b: number | null | undefined) => (a == null || !b) ? '—' : `${Math.round(a / b * 100)}%`

/** 表に出す1行（円・丸めない。表示のときに 0.1万で丸める。部門計だけは店ごとに丸めた値の和） */
interface Row { ly_s: number | null; init_s: number | null; fc_s: number | null; rev_s: number | null; act_s: number | null
  plan_s: number | null; plan_c: number | null; plan_p: number | null; act_c: number | null; act_p: number | null; ly_c: number | null; ly_p: number | null
  /** 実績のある月だけの計画売上（達成率の分母）・前年売上（前年比の分母） */ pa_s: number | null; la_s: number | null }
const EMPTY: Row = { ly_s: null, init_s: null, fc_s: null, rev_s: null, act_s: null, plan_s: null, plan_c: null, plan_p: null, act_c: null, act_p: null, ly_c: null, ly_p: null, pa_s: null, la_s: null }

function monthRow(d: StoreData, m: number, ver: PlanVer): Row {
  const a = pl(d.act[m]), y = pl(d.ly[m]), i = pl(d.init[m]), f = pl(d.fc[m]), rv = pl(d.rev[m])
  const p = ver === 'rev' && rv ? rv : i
  return {
    ly_s: y && y.sales, init_s: i && i.sales, fc_s: f && f.sales, rev_s: rv && rv.sales, act_s: a && a.sales,
    plan_s: p && p.sales, plan_c: p && p.cost, plan_p: p && p.profit,
    act_c: a && a.cost, act_p: a && a.profit, ly_c: y && y.cost, ly_p: y && y.profit,
    // 下期修正の列は、修正の無い月を期初目標で補う（合計行で「修正後の年間目標」を出すため）。月の行では修正の無い月は空欄にする
    pa_s: a && p ? p.sales : null, la_s: a && y ? y.sales : null,
  }
}
/** 合計行。null を含む列は「全月そろっているときだけ」足す（act は入っている月だけ足す） */
function sumRows(rows: Row[], partialActual = true): Row {
  const out: Row = { ...EMPTY }
  for (const k of Object.keys(EMPTY) as (keyof Row)[]) {
    const vals = rows.map(r => r[k])
    const isAct = k.startsWith('act') || k === 'pa_s' || k === 'la_s'
    if (k === 'rev_s') {
      const any = rows.some(r => r.rev_s != null)
      const filled = rows.map(r => r.rev_s ?? r.init_s)
      out[k] = any && filled.every(x => x != null) ? filled.reduce((s: number, x) => s + (x as number), 0) : null
    } else if (isAct && partialActual) {
      const v = vals.filter((x): x is number => x != null)
      out[k] = v.length ? v.reduce((s, x) => s + x, 0) : null
    } else {
      out[k] = vals.some(x => x == null) ? null : vals.reduce((s: number, x) => s + (x as number), 0)
    }
  }
  return out
}
/** 部門計の行: 店ごとに 0.1万で丸めてから足す（円に戻して持つ） */
function addRows(a: Row, b: Row): Row {
  const out: Row = { ...EMPTY }
  for (const k of Object.keys(EMPTY) as (keyof Row)[]) {
    const x = a[k], y = b[k]
    out[k] = x == null || y == null ? null : Math.round((r1(x) + r1(y)) * 10) * 1000
  }
  return out
}
/** 円 → 万円表示 */
const fm = (x: number | null | undefined, d = 1) => fmt(x == null ? null : r1(x), d)

export function ReportSet() {
  const fyNow = currentFiscalYear()
  // 条件は URL でも指定できる（例: /uribo/report?fy=2026&mode=half&half=1&ver=init&fc=1）＝会議ごとにブックマーク可
  const q = new URLSearchParams(window.location.search)
  const prevMonth = (() => { const m = new Date().getMonth(); return m === 0 ? 12 : m })()  // 既定=前月
  const [fy, setFy] = useState(Number(q.get('fy')) || (prevMonth === 3 ? fyNow - 1 : fyNow))
  const [mode, setMode] = useState<Mode>(q.get('mode') === 'half' ? 'half' : 'month')
  const [month, setMonth] = useState<number>(Number(q.get('m')) || prevMonth)
  const [half, setHalf] = useState<1 | 2>(q.get('half') === '2' ? 2 : 1)
  const [ver, setVer] = useState<PlanVer>(q.get('ver') === 'init' ? 'init' : 'rev')
  const [showFc, setShowFc] = useState(q.get('fc') === '1')
  useEffect(() => {
    const sp = new URLSearchParams({ fy: String(fy), mode, ...(mode === 'month' ? { m: String(month) } : { half: String(half) }), ver, ...(showFc ? { fc: '1' } : {}) })
    window.history.replaceState(null, '', `${window.location.pathname}?${sp}`)
  }, [fy, mode, month, half, ver, showFc])
  const [data, setData] = useState<Record<number, StoreData> | null>(null)
  const [loadedFy, setLoadedFy] = useState<number | null>(null)
  const loading = loadedFy !== fy

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const im = await apiGet<{ id: number; item_code: string }[]>('beauty_item_master', { select: 'id,item_code' })
      const code: Record<number, string> = {}
      for (const i of im.data ?? []) code[i.id] = i.item_code
      const res: Record<number, StoreData> = {}
      await Promise.all(STORES.map(async s => {
        const keys: Key[] = ['act', 'ly', 'init', 'fc', 'rev']
        const got = await Promise.all(keys.map(k => fetchKey(code, s.id, fy, k)))
        res[s.id] = Object.fromEntries(keys.map((k, i) => [k, got[i]])) as StoreData
      }))
      if (!cancel) { setData(res); setLoadedFy(fy) }
    })()
    return () => { cancel = true }
  }, [fy])

  const hasRev = useMemo(() => !!data && STORES.some(s => Object.keys(data[s.id].rev).length > 0), [data])
  const hasFc = useMemo(() => !!data && STORES.some(s => Object.keys(data[s.id].fc).length > 0), [data])
  const H1 = [4, 5, 6, 7, 8, 9], H2 = [10, 11, 12, 1, 2, 3]
  const periodMonths = mode === 'half' ? (half === 1 ? H1 : H2) : FISCAL_MONTHS.slice(0, FISCAL_MONTHS.indexOf(month as typeof FISCAL_MONTHS[number]) + 1)
  const verLabel = ver === 'rev' && hasRev ? '下期修正' : '期初目標'
  const title = mode === 'half' ? `${half === 1 ? '上' : '下'}半期報告` : `${MONTH_LABELS[month]}の月次報告`
  const calYear = (m: number) => (m >= 4 ? fy : fy + 1)

  // 店ごと・部門計の月別行
  const table = useMemo(() => {
    if (!data) return null
    const per: Record<string, Record<number, Row>> = {}
    for (const s of STORES) {
      per[s.id] = {}
      for (const m of FISCAL_MONTHS) per[s.id][m] = monthRow(data[s.id], m, ver)
    }
    per.all = {}
    for (const m of FISCAL_MONTHS) per.all[m] = addRows(per[1][m], per[2][m])
    return per
  }, [data, ver])

  const totalOf = (key: string, months: number[]) => {
    if (!table) return EMPTY
    if (key === 'all') return addRows(sumRows(months.map(m => table[1][m])), sumRows(months.map(m => table[2][m])))
    return sumRows(months.map(m => table[key][m]))
  }

  if (loading || !data || !table) return <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)' }}>読み込み中…</div>

  const sheets: { key: string; name: string }[] = [{ key: 'all', name: '部門計（寝屋川＋守口）' }, ...STORES.map(s => ({ key: String(s.id), name: s.name }))]

  return (
    <div className="rp">
      <div className="page-head no-print">
        <div>
          <div className="page-title-row"><span className="page-index">— 08 / REPORT</span><h1 className="page-title">報告セット</h1></div>
          <div className="page-subtitle">会議で配る数枚をまとめて印刷します。条件を選んで「印刷」を押してください（A4横）。</div>
        </div>
        <button className="rp-print" onClick={() => window.print()}>この内容で印刷</button>
      </div>

      <div className="rp-controls no-print">
        <label>年度
          <select className="select" value={fy} onChange={e => setFy(Number(e.target.value))}>
            {[fyNow + 1, fyNow, fyNow - 1, fyNow - 2].map(y => <option key={y} value={y}>{y}年度</option>)}
          </select>
        </label>
        <div className="seg">
          <button className="seg-btn" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>月次報告</button>
          <button className="seg-btn" aria-pressed={mode === 'half'} onClick={() => setMode('half')}>半期報告</button>
        </div>
        {mode === 'month' ? (
          <label>対象月
            <select className="select" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {FISCAL_MONTHS.map(m => <option key={m} value={m}>{calYear(m)}年{m}月</option>)}
            </select>
          </label>
        ) : (
          <div className="seg">
            <button className="seg-btn" aria-pressed={half === 1} onClick={() => setHalf(1)}>上半期（4〜9月）</button>
            <button className="seg-btn" aria-pressed={half === 2} onClick={() => setHalf(2)}>下半期（10〜3月）</button>
          </div>
        )}
        <div className="seg" title="計画（経費・純利益）と達成率をどの目標で見るか">
          <button className="seg-btn" aria-pressed={ver === 'init'} onClick={() => setVer('init')}>期初目標で見る</button>
          <button className="seg-btn" aria-pressed={ver === 'rev'} onClick={() => setVer('rev')} disabled={!hasRev}>下期修正で見る</button>
        </div>
        {hasFc && <label className="rp-check"><input type="checkbox" checked={showFc} onChange={e => setShowFc(e.target.checked)} />見通しも並べる</label>}
      </div>

      {/* 1枚目: 表紙 */}
      <section className="rp-sheet">
        <div className="rp-sheet-h">
          <h2>美容部 {title}</h2>
          <div className="rp-sub">FY{fy}（{fy}年4月〜{fy + 1}年3月）・単位 万円・計画は「{verLabel}」</div>
        </div>
        <Cover sheets={sheets} cur={mode === 'month' ? [month] : periodMonths} ytd={mode === 'month' ? periodMonths : null}
          year={FISCAL_MONTHS as unknown as number[]} totalOf={totalOf} mode={mode} title={title} data={data} />
        <p className="rp-foot">純利益＝売上（割引前）−割引−経費−減価償却（6.4万円/月・店）。消費税の預かり・納付は別枠。賞与は支給した月の経費に入ります。期初目標は賞与を見込んだ月がありますが、下期修正は賞与を入れていません（下期修正の純利益は賞与前）。
          {hasRev && ' 期初目標は期初に登録したままの数字、下期修正は期中に見直した数字です。下期修正が無い月は期初目標を使います。'}</p>
      </section>

      {/* 一年通しの表（部門計・店ごと） */}
      {sheets.map(s => (
        <section className="rp-sheet" key={'y' + s.key}>
          <div className="rp-sheet-h"><h2>{s.name} 一年通し</h2><div className="rp-sub">FY{fy}・万円・計画＝{verLabel}</div></div>
          <YearTable rows={table[s.key]} total={(ms: number[]) => totalOf(s.key, ms)} showFc={showFc && hasFc} showRev={hasRev} highlight={periodMonths} />
        </section>
      ))}

      {/* 科目別の表（店ごと） */}
      {sheets.map(s => (
        <section className="rp-sheet" key={'k' + s.key}>
          {mode === 'month'
            ? <MonthItems name={s.name} fy={fy} m={month} ytd={periodMonths} data={data} sk={s.key} ver={ver} verLabel={verLabel} />
            : <HalfItems name={s.name} fy={fy} months={periodMonths} half={half} data={data} sk={s.key} ver={ver} verLabel={verLabel} />}
        </section>
      ))}
    </div>
  )
}

/* ───────── 表紙 ───────── */
function Cover({ sheets, cur, ytd, year, totalOf, mode, title, data }: {
  sheets: { key: string; name: string }[]; cur: number[]; ytd: number[] | null; year: number[]
  totalOf: (k: string, ms: number[]) => Row; mode: Mode; title: string; data: Record<number, StoreData>
}) {
  const bonus = (key: string, ms: number[]) => {
    const ids = key === 'all' ? [1, 2] : [Number(key)]
    let b = 0
    for (const id of ids) for (const m of ms) b += data[id].act[m]?.bonus ?? 0
    return b
  }
  const block = (label: string, r: Row, b: number) => (
    <div className="rp-blk">
      <div className="rp-blk-l">{label}</div>
      <div className="rp-kv"><span>売上</span><b>{fm(r.act_s)}</b><small>計画 {fm(r.plan_s)}・<em className={r.act_s != null && r.pa_s != null && r.act_s >= r.pa_s ? 'ok' : 'ng'}>{r.pa_s != null && r.plan_s != null && r1(r.pa_s) !== r1(r.plan_s) ? `実績のある月で ${pctTxt(r.act_s, r.pa_s)}` : pctTxt(r.act_s, r.pa_s)}</em>・前年比 {pctTxt(r.act_s, r.la_s)}</small></div>
      <div className="rp-kv"><span>純利益</span><b className={r.act_p != null && r.act_p < 0 ? 'ng' : ''}>{fm(r.act_p)}</b><small>計画 {fm(r.plan_p)}・前年 {fm(r.ly_p)}{b ? `・賞与 ${fm(b)} 計上後` : ''}</small></div>
    </div>
  )
  return (
    <div className="rp-cover">
      {sheets.map(s => {
        const c = totalOf(s.key, cur)
        // 通期の見込み＝実績のある月は実績、ない月は計画
        // 部門計は店ごとの見込みを 0.1万で丸めてから足す
        const fcOf = (k: string) => {
          const ym = year.map(m => totalOf(k, [m]))
          return [ym.reduce((t, r) => t + (r.act_s ?? r.plan_s ?? 0), 0), ym.reduce((t, r) => t + (r.act_s != null ? (r.act_p ?? 0) : (r.plan_p ?? 0)), 0)]
        }
        const [fcS, fcP] = s.key === 'all'
          ? (() => { const a = fcOf('1'), b = fcOf('2'); return [(r1(a[0]) + r1(b[0])) * 1e4, (r1(a[1]) + r1(b[1])) * 1e4] })()
          : fcOf(s.key)
        return (
          <div className={'rp-card' + (s.key === 'all' ? ' main' : '')} key={s.key}>
            <h3>{s.name}</h3>
            {block(mode === 'month' ? title.replace('の月次報告', '') : title.replace('報告', ''), c, bonus(s.key, cur))}
            {ytd && block(`年度累計（4月〜${MONTH_LABELS[ytd[ytd.length - 1]]}）`, totalOf(s.key, ytd), bonus(s.key, ytd))}
            <div className="rp-blk last">
              <div className="rp-blk-l">通期の見込み（実績＋残りの月は計画）</div>
              <div className="rp-kv"><span>売上</span><b>{fm(fcS)}</b><small>年間計画 {fm(totalOf(s.key, year).plan_s)}</small></div>
              <div className="rp-kv"><span>純利益</span><b>{fm(fcP)}</b><small>年間計画 {fm(totalOf(s.key, year).plan_p)}</small></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ───────── 一年通しの表 ───────── */
function YearTable({ rows, total, showFc, showRev, highlight }: {
  rows: Record<number, Row>; total: (ms: number[]) => Row; showFc: boolean; showRev: boolean; highlight: number[]
}) {
  const H1 = [4, 5, 6, 7, 8, 9], H2 = [10, 11, 12, 1, 2, 3]
  const nSales = 4 + (showFc ? 1 : 0) + (showRev ? 1 : 0)
  const lastAct = [...H1, ...H2].filter(m => rows[m].act_s != null).pop()
  const td = (v: number | null, cls = '') => <td className={cls + (v != null && v < 0 ? ' ng' : '')}>{fm(v)}</td>
  const revCell = (r: Row) => {
    if (r.rev_s == null) return <td className="z">—</td>
    const diff = r.init_s != null ? r1(r.rev_s) - r1(r.init_s) : null
    return <td>{fm(r.rev_s)}{diff && Math.abs(diff) >= 0.5 ? <small className={diff > 0 ? 'up' : 'dn'}>{diff > 0 ? '+' : '−'}{fmt(Math.abs(diff), 0)}</small> : null}</td>
  }
  const line = (label: string, r: Row, cls = '') => (
    <tr className={cls} key={label}>
      <td className="nm">{label}</td>
      {td(r.ly_s, 'ref')}{td(r.init_s)}{showFc && td(r.fc_s, 'fc')}{showRev && revCell(r)}{td(r.act_s, 'act')}
      <td className={r.act_s != null && r.pa_s ? (r.act_s >= r.pa_s ? 'ok' : 'ng') : 'z'}>{pctTxt(r.act_s, r.pa_s)}</td>
      {td(r.plan_c)}{td(r.act_c, 'act')}
      {td(r.ly_p, 'ref')}{td(r.plan_p)}{td(r.act_p, 'act prof')}
    </tr>
  )
  return (
    <table className="rp-table">
      <thead>
        <tr><th rowSpan={2} className="nm">月</th><th colSpan={nSales}>売上</th><th colSpan={2}>経費（割引込み）</th><th colSpan={3}>純利益</th></tr>
        <tr><th className="ref">前年</th><th>期初目標</th>{showFc && <th className="fc">見通し</th>}{showRev && <th>下期修正</th>}<th className="act">実績</th><th>達成率</th>
          <th>計画</th><th className="act">実績</th><th className="ref">前年</th><th>計画</th><th className="act">実績</th></tr>
      </thead>
      <tbody>
        {H1.map(m => line(MONTH_LABELS[m], rows[m], highlight.includes(m) ? 'hl' : ''))}
        {line('上半期計', total(H1), 'sum')}
        {H2.map(m => line(MONTH_LABELS[m], rows[m], highlight.includes(m) ? 'hl' : ''))}
        {line('下半期計', total(H2), 'sum')}
        {line(lastAct ? `通期（実績は${MONTH_LABELS[lastAct]}まで）` : '通期', total([...H1, ...H2]), 'year')}
      </tbody>
    </table>
  )
}

/* ───────── 科目別（月次・半期） ─────────
   部門計は「店ごとに 0.1万で丸めてから足す」（一年通しの表・報告書と同じ丸め） */
type Line = { name: string; group?: string; span?: number; inGroup: boolean; get: (v: Vals | undefined) => number | null; cls?: string }
function itemLines(): Line[] {
  const L: Line[] = [
    { name: '売上（割引前）', inGroup: false, get: v => v?.sales ? v.sales : null, cls: 'strong' },
    { name: '割引', inGroup: false, get: v => v?.sales ? -(v.discount ?? 0) : null, cls: 'sub' },
  ]
  for (const g of GROUPS) g.rows.forEach((r, i) => L.push({ name: r.name, inGroup: true, group: i === 0 ? g.head : undefined, span: i === 0 ? g.rows.length : undefined, get: v => groupVal(v, r.codes) }))
  L.push({ name: '経費合計（割引を除く）', inGroup: false, get: v => { const p = pl(v); return p ? p.cost - (v?.discount ?? 0) : null }, cls: 'sum' })
  L.push({ name: '純利益', inGroup: false, get: v => pl(v)?.profit ?? null, cls: 'prof' })
  return L
}
const idsOf = (sk: string) => sk === 'all' ? [1, 2] : [Number(sk)]
function makeV(data: Record<number, StoreData>, sk: string, ver: PlanVer) {
  const src = (id: number, key: Key | 'plan', m: number) => {
    const d = data[id]
    if (key !== 'plan') return d[key][m]
    return ver === 'rev' && d.rev[m]?.sales ? d.rev[m] : d.init[m]
  }
  /** 万円（丸め済み）。months 全部に値がある店だけ足す。どれか欠けたら null */
  return (l: Line, key: Key | 'plan', months: number[]): number | null => {
    let tot = 0
    for (const id of idsOf(sk)) {
      let s = 0
      for (const m of months) {
        const x = l.get(src(id, key, m))
        if (x == null) return null
        s += x
      }
      tot += r1(s)
    }
    return Math.round(tot * 10) / 10
  }
}
const actMonthsOf = (data: Record<number, StoreData>, sk: string, ms: number[]) => ms.filter(m => idsOf(sk).every(id => data[id].act[m]?.sales))
const c = (y: number | null, cls = '') => <td className={cls + (y != null && y < 0 ? ' ng' : '')}>{fmt(y)}</td>
const df = (a: number | null, b: number | null) => a == null || b == null ? null : Math.round((a - b) * 10) / 10
/** 差のセル。経費の行は「計画より多く使った（プラス）」を赤にする */
const dc = (v: number | null, l: Line) => {
  const isCost = l.inGroup || l.cls === 'sum'
  const bad = v != null && (isCost ? v > 0.05 : v < -0.05)
  return <td className={'diff' + (bad ? ' ng' : '')}>{fmt(v)}</td>
}

function MonthItems({ name, fy, m, ytd, data, sk, ver, verLabel }: {
  name: string; fy: number; m: number; ytd: number[]; data: Record<number, StoreData>; sk: string; ver: PlanVer; verLabel: string
}) {
  const V = makeV(data, sk, ver)
  const yAct = actMonthsOf(data, sk, ytd)
  return (
    <>
      <div className="rp-sheet-h"><h2>{name} {MONTH_LABELS[m]}の科目別</h2><div className="rp-sub">FY{fy}・万円・計画＝{verLabel}</div></div>
      <table className="rp-table items">
        <thead>
          <tr><th className="nm" colSpan={2} rowSpan={2}>科目</th><th colSpan={4}>{MONTH_LABELS[m]}</th><th colSpan={3}>年度累計（実績のある {yAct.length}か月）</th></tr>
          <tr><th>計画</th><th className="act">実績</th><th>差（実績−計画）</th><th className="ref">前年同月</th><th>計画</th><th className="act">実績</th><th>差</th></tr>
        </thead>
        <tbody>
          {itemLines().map(l => {
            const p = V(l, 'plan', [m]), a = V(l, 'act', [m]), y = V(l, 'ly', [m])
            const cp = yAct.length ? V(l, 'plan', yAct) : null, ca = yAct.length ? V(l, 'act', yAct) : null
            return (
              <tr key={l.name} className={l.cls ?? ''}>
                {l.group && <td className="grp" rowSpan={l.span}>{l.group}</td>}
                <td className="nm" colSpan={l.inGroup ? 1 : 2}>{l.name}</td>
                {c(p)}{c(a, 'act')}{dc(df(a, p), l)}{c(y, 'ref')}{c(cp)}{c(ca, 'act')}{dc(df(ca, cp), l)}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="rp-foot">差の赤は計画より悪い方向（売上・利益は不足、経費は使いすぎ）。割引は売上から引く額なのでマイナス表示。</p>
    </>
  )
}

/* ───────── 科目別（半期・月ごと） ───────── */
function HalfItems({ name, fy, months, half, data, sk, ver, verLabel }: {
  name: string; fy: number; months: number[]; half: 1 | 2; data: Record<number, StoreData>; sk: string; ver: PlanVer; verLabel: string
}) {
  const V = makeV(data, sk, ver)
  const am = actMonthsOf(data, sk, months)
  return (
    <>
      <div className="rp-sheet-h"><h2>{name} {half === 1 ? '上' : '下'}半期の科目別（実績）</h2><div className="rp-sub">FY{fy}・万円・右端の計画＝{verLabel}</div></div>
      <table className="rp-table items">
        <thead><tr><th className="nm" colSpan={2}>科目</th>{months.map(m => <th key={m} className="act">{MONTH_LABELS[m]}</th>)}<th className="act">実績計</th><th>計画計</th><th>差</th></tr></thead>
        <tbody>
          {itemLines().map(l => {
            const a = am.length ? V(l, 'act', am) : null, p = am.length ? V(l, 'plan', am) : null
            return (
              <tr key={l.name} className={l.cls ?? ''}>
                {l.group && <td className="grp" rowSpan={l.span}>{l.group}</td>}
                <td className="nm" colSpan={l.inGroup ? 1 : 2}>{l.name}</td>
                {months.map(m => <td key={m} className={(V(l, 'act', [m]) ?? 0) < 0 ? 'ng' : ''}>{fmt(V(l, 'act', [m]))}</td>)}
                {c(a, 'act')}{c(p)}{dc(df(a, p), l)}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="rp-foot">実績計・計画計は実績が入っている月（{am.map(m => MONTH_LABELS[m]).join('・') || 'なし'}）の合計。</p>
    </>
  )
}
