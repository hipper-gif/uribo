import { Fragment, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch } from '../lib/api'
import { fetchBeautyStaff, type MnemeEmployee } from '../lib/mnemeApi'

interface PayrollRow {
  id: number
  employee_id: number
  store_id: number
  year: number
  month: number
  sales_total: number
  sales_treatment: number
  sales_product: number
  sales_option: number
  customers_total: number
  customers_new: number
  customers_repeat: number
  nomination_count_scraped: number
  nomination_sales: number
  base_salary: number
  commission_amount: number
  position_allowance: number
  nomination_count_actual: number
  nomination_allowance: number
  paid_leave_days: string | number
  overtime_hours: string | number
  transit_amount: number
  reimbursement: number
  perfect_attendance: number
  perfect_attendance_accrual: number
  total_amount: number
  gross_total: number
  net_payment: number
  social_insurance_total: number
  income_tax: number
  resident_tax: number
  tkc_pdf_filename: string | null
  tkc_verified_at: string | null
  status: 'draft' | 'confirmed' | 'tkc_entered'
  notes: string | null
}

const STORE_LABEL: Record<number, string> = { 1: '寝屋川', 2: '守口' }

const STATUS_BADGE: Record<PayrollRow['status'], { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-amber-100 text-amber-800' },
  confirmed: { label: '確定', cls: 'bg-blue-100 text-blue-800' },
  tkc_entered: { label: 'TKC入力済', cls: 'bg-green-100 text-green-800' },
}

function prevMonth(): { year: number; month: number } {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function fmt(n: number | string | null | undefined): string {
  if (n == null || n === '') return '-'
  const num = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(num) || num === 0) return '-'
  return Number(num).toLocaleString()
}

function calcTotal(r: Partial<PayrollRow>): number {
  return (
    (Number(r.base_salary) || 0) +
    (Number(r.commission_amount) || 0) +
    (Number(r.nomination_allowance) || 0) +
    (Number(r.position_allowance) || 0) +
    (Number(r.transit_amount) || 0) -
    0
  )
}

export function Payroll() {
  const init = prevMonth()
  const [year, setYear] = useState(init.year)
  const [month, setMonth] = useState(init.month)
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [staff, setStaff] = useState<MnemeEmployee[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<Partial<PayrollRow>>({})
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const empMap = useMemo(() => {
    const m: Record<number, MnemeEmployee> = {}
    for (const s of staff) m[s.id] = s
    return m
  }, [staff])

  async function load() {
    setLoading(true)
    setError(null)
    const [{ data, error: e1 }, st] = await Promise.all([
      apiGet<PayrollRow[]>('beauty_payroll_monthly', {
        year: `eq.${year}`,
        month: `eq.${month}`,
        order: 'store_id.asc,total_amount.desc',
      }),
      fetchBeautyStaff(),
    ])
    if (e1) setError(e1.message)
    setRows(data ?? [])
    setStaff(st)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  function startEdit(r: PayrollRow) {
    setEditing(r.id)
    setDraft({
      nomination_count_actual: r.nomination_count_actual,
      paid_leave_days: r.paid_leave_days,
      overtime_hours: r.overtime_hours,
      transit_amount: r.transit_amount,
      reimbursement: r.reimbursement,
      perfect_attendance: r.perfect_attendance,
      notes: r.notes ?? '',
    })
  }

  function cancelEdit() {
    setEditing(null)
    setDraft({})
  }

  async function saveEdit(orig: PayrollRow) {
    const merged: Partial<PayrollRow> = { ...orig, ...draft }
    const nomActual = Number(draft.nomination_count_actual ?? orig.nomination_count_actual) || 0
    merged.nomination_count_actual = nomActual
    merged.nomination_allowance = nomActual * 500
    merged.perfect_attendance_accrual = (Number(draft.perfect_attendance) || 0) ? 5000 : 0
    const total = calcTotal(merged)
    merged.total_amount = total

    const patch: Record<string, unknown> = {
      nomination_count_actual: merged.nomination_count_actual,
      nomination_allowance: merged.nomination_allowance,
      paid_leave_days: merged.paid_leave_days ?? 0,
      overtime_hours: merged.overtime_hours ?? 0,
      transit_amount: Number(merged.transit_amount) || 0,
      reimbursement: Number(merged.reimbursement) || 0,
      perfect_attendance: Number(merged.perfect_attendance) || 0,
      perfect_attendance_accrual: merged.perfect_attendance_accrual,
      total_amount: merged.total_amount,
      notes: merged.notes,
    }
    const { error: e } = await apiPatch('beauty_payroll_monthly', { id: `eq.${orig.id}` }, patch)
    if (e) {
      alert('保存失敗: ' + e.message)
      return
    }
    cancelEdit()
    load()
  }

  async function transition(r: PayrollRow, to: PayrollRow['status']) {
    if (!confirm(`${empMap[r.employee_id]?.name ?? r.employee_id} を「${STATUS_BADGE[to].label}」に変更します。よろしいですか？`)) return
    const patch: Record<string, unknown> = { status: to }
    if (to === 'confirmed') patch.confirmed_at = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const { error: e } = await apiPatch('beauty_payroll_monthly', { id: `eq.${r.id}` }, patch)
    if (e) alert('変更失敗: ' + e.message)
    else load()
  }

  const monthOptions: { y: number; m: number }[] = []
  const today = new Date()
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    monthOptions.push({ y: d.getFullYear(), m: d.getMonth() + 1 })
  }

  const totalSales = rows.reduce((s, r) => s + (r.sales_total || 0), 0)
  const totalPay = rows.reduce((s, r) => s + (r.total_amount || 0), 0)

  return (
    <div className="payroll-page" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>美容部 給与計算</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={`${year}-${month}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              setYear(y); setMonth(m)
            }}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc' }}
          >
            {monthOptions.map(o => (
              <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>
                {o.y}年{o.m}月分
              </option>
            ))}
          </select>
          <button
            onClick={load}
            style={{ padding: '6px 12px', borderRadius: 6, background: '#3a4ddb', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            更新
          </button>
        </div>
      </div>

      {error && <div style={{ background: '#fee', color: '#a00', padding: 8, borderRadius: 6, marginBottom: 8 }}>{error}</div>}
      {loading && <div>読み込み中...</div>}

      {!loading && rows.length === 0 && (
        <div style={{ padding: 24, textAlign: 'center', background: '#fff7d6', borderRadius: 8 }}>
          {year}年{month}月分のデータはまだ投入されていません。<br/>
          <code>python sync_salonboard.py --with-staff --month {year}-{String(month).padStart(2, '0')}</code> を実行してください。
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 13, color: '#666' }}>
            <span>対象 <b>{rows.length}</b>名</span>
            <span>売上合計 <b>¥{totalSales.toLocaleString()}</b></span>
            <span>支給合計 <b>¥{totalPay.toLocaleString()}</b></span>
          </div>

          <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f5efe0', textAlign: 'left' }}>
                <tr>
                  <th style={{ padding: '8px 6px' }}>店</th>
                  <th style={{ padding: '8px 6px' }}>スタッフ</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>売上</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>歩合</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>指名件数</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>指名手当</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>基本給</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>役職</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>有給</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>残業</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>交通費</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>立替</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>皆勤</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right' }}>合計</th>
                  <th style={{ padding: '8px 6px' }}>状態</th>
                  <th style={{ padding: '8px 6px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const isEdit = editing === r.id
                  const e = empMap[r.employee_id]
                  return (
                    <Fragment key={r.id}>
                    <tr style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '8px 6px' }}>{STORE_LABEL[r.store_id] ?? r.store_id}</td>
                      <td style={{ padding: '8px 6px' }}>{e?.name ?? `(emp=${r.employee_id})`}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmt(r.sales_total)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmt(r.commission_amount)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input
                            type="number" min="0"
                            value={String(draft.nomination_count_actual ?? r.nomination_count_actual)}
                            onChange={ev => setDraft(d => ({ ...d, nomination_count_actual: Number(ev.target.value) || 0 }))}
                            style={{ width: 60, textAlign: 'right', padding: 2 }}
                          />
                        ) : (
                          <>{r.nomination_count_actual}<span style={{ color: '#999', fontSize: 11 }}> /{r.nomination_count_scraped}</span></>
                        )}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {fmt(isEdit ? (Number(draft.nomination_count_actual ?? r.nomination_count_actual) * 500) : r.nomination_allowance)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmt(r.base_salary)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{fmt(r.position_allowance)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input type="number" step="0.5" min="0"
                            value={String(draft.paid_leave_days ?? r.paid_leave_days)}
                            onChange={ev => setDraft(d => ({ ...d, paid_leave_days: ev.target.value }))}
                            style={{ width: 50, textAlign: 'right', padding: 2 }}
                          />
                        ) : (Number(r.paid_leave_days) || 0).toFixed(1)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input type="number" step="0.25" min="0"
                            value={String(draft.overtime_hours ?? r.overtime_hours)}
                            onChange={ev => setDraft(d => ({ ...d, overtime_hours: ev.target.value }))}
                            style={{ width: 60, textAlign: 'right', padding: 2 }}
                          />
                        ) : (Number(r.overtime_hours) || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input type="number" min="0"
                            value={String(draft.transit_amount ?? r.transit_amount)}
                            onChange={ev => setDraft(d => ({ ...d, transit_amount: Number(ev.target.value) || 0 }))}
                            style={{ width: 70, textAlign: 'right', padding: 2 }}
                          />
                        ) : fmt(r.transit_amount)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input type="number" min="0"
                            value={String(draft.reimbursement ?? r.reimbursement)}
                            onChange={ev => setDraft(d => ({ ...d, reimbursement: Number(ev.target.value) || 0 }))}
                            style={{ width: 70, textAlign: 'right', padding: 2 }}
                          />
                        ) : fmt(r.reimbursement)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {isEdit ? (
                          <input type="checkbox"
                            checked={!!(draft.perfect_attendance ?? r.perfect_attendance)}
                            onChange={ev => setDraft(d => ({ ...d, perfect_attendance: ev.target.checked ? 1 : 0 }))}
                          />
                        ) : (r.perfect_attendance ? '◯' : '-')}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>
                        {fmt(isEdit ? calcTotal({
                          ...r,
                          ...draft,
                          nomination_allowance: (Number(draft.nomination_count_actual ?? r.nomination_count_actual) || 0) * 500,
                        }) : r.total_amount)}
                      </td>
                      <td style={{ padding: '8px 6px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11 }} className={STATUS_BADGE[r.status].cls}>
                          {STATUS_BADGE[r.status].label}
                        </span>
                      </td>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        {isEdit ? (
                          <>
                            <button onClick={() => saveEdit(r)} style={{ marginRight: 4, padding: '3px 8px', background: '#3a4ddb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>保存</button>
                            <button onClick={cancelEdit} style={{ padding: '3px 8px', background: '#ddd', border: 'none', borderRadius: 4, cursor: 'pointer' }}>取消</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => toggleExpand(r.id)} style={{ marginRight: 4, padding: '3px 8px', background: '#fff', border: '1px solid #aaa', borderRadius: 4, cursor: 'pointer' }}>{expanded.has(r.id) ? '閉じる' : '明細'}</button>
                            <button onClick={() => startEdit(r)} style={{ marginRight: 4, padding: '3px 8px', background: '#fff', border: '1px solid #aaa', borderRadius: 4, cursor: 'pointer' }}>編集</button>
                            {r.status === 'draft' && (
                              <button onClick={() => transition(r, 'confirmed')} style={{ marginRight: 4, padding: '3px 8px', background: '#3a4ddb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>確定</button>
                            )}
                            {r.status === 'confirmed' && (
                              <button onClick={() => transition(r, 'tkc_entered')} style={{ padding: '3px 8px', background: '#0a8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>TKC入力済</button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {expanded.has(r.id) && (
                      <tr>
                        <td colSpan={16} style={{ background: '#fafaf6', padding: '12px 20px', borderTop: '1px dashed #ddd' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px 24px' }}>
                            <div>
                              <h4 style={{ margin: '0 0 8px', fontSize: 12, color: '#666', borderBottom: '1px solid #ddd', paddingBottom: 4 }}>TKC明細（PDF反映値）</h4>
                              {r.tkc_verified_at ? (
                                <table style={{ fontSize: 12, width: '100%' }}>
                                  <tbody>
                                    <tr><td style={{ color: '#777' }}>支給合計</td><td style={{ textAlign: 'right', fontWeight: 600 }}>¥{r.gross_total.toLocaleString()}</td></tr>
                                    <tr><td style={{ color: '#777' }}>社会保険料合計</td><td style={{ textAlign: 'right' }}>¥{r.social_insurance_total.toLocaleString()}</td></tr>
                                    <tr><td style={{ color: '#777' }}>所得税</td><td style={{ textAlign: 'right' }}>¥{r.income_tax.toLocaleString()}</td></tr>
                                    <tr><td style={{ color: '#777' }}>住民税</td><td style={{ textAlign: 'right' }}>¥{r.resident_tax.toLocaleString()}</td></tr>
                                    <tr><td style={{ color: '#777', borderTop: '1px solid #ddd', paddingTop: 4 }}>差引支給額</td><td style={{ textAlign: 'right', fontWeight: 700, color: '#0a8', borderTop: '1px solid #ddd', paddingTop: 4 }}>¥{r.net_payment.toLocaleString()}</td></tr>
                                  </tbody>
                                </table>
                              ) : (
                                <div style={{ color: '#999', fontSize: 12 }}>まだPDF反映されていません<br/><small>杉原さんがTKC入力後、verify_tkc_pdf.py --apply で反映されます</small></div>
                              )}
                              {r.tkc_pdf_filename && (
                                <div style={{ fontSize: 10, color: '#aaa', marginTop: 8 }}>
                                  反映ファイル: {r.tkc_pdf_filename}<br/>
                                  反映日時: {r.tkc_verified_at?.slice(0, 16)}
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 style={{ margin: '0 0 8px', fontSize: 12, color: '#666', borderBottom: '1px solid #ddd', paddingBottom: 4 }}>サロンボード参考値</h4>
                              <table style={{ fontSize: 12, width: '100%' }}>
                                <tbody>
                                  <tr><td style={{ color: '#777' }}>総売上</td><td style={{ textAlign: 'right' }}>¥{r.sales_total.toLocaleString()}</td></tr>
                                  <tr><td style={{ color: '#777' }}>　施術</td><td style={{ textAlign: 'right', color: '#888' }}>¥{r.sales_treatment.toLocaleString()}</td></tr>
                                  <tr><td style={{ color: '#777' }}>　店販</td><td style={{ textAlign: 'right', color: '#888' }}>¥{r.sales_product.toLocaleString()}</td></tr>
                                  <tr><td style={{ color: '#777' }}>　オプション</td><td style={{ textAlign: 'right', color: '#888' }}>¥{r.sales_option.toLocaleString()}</td></tr>
                                  <tr><td style={{ color: '#777' }}>客数</td><td style={{ textAlign: 'right' }}>{r.customers_total} (新{r.customers_new} / 再{r.customers_repeat})</td></tr>
                                  <tr><td style={{ color: '#777' }}>指名売上</td><td style={{ textAlign: 'right' }}>¥{r.nomination_sales.toLocaleString()}</td></tr>
                                  <tr><td style={{ color: '#777' }}>サロンボード指名件数</td><td style={{ textAlign: 'right', color: '#888' }}>{r.nomination_count_scraped}件 (実績: {r.nomination_count_actual}件)</td></tr>
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
            <p>・指名件数: 「実績/サロンボード値」表示。実績を編集すると指名手当(×¥500)・合計が自動再計算。</p>
            <p>・パート(時給制)の基本給は0表示。時給×勤務時間はTKC側で確定。</p>
            <p>・皆勤手当 ¥5,000 は積立、月次合計には含めず賞与で精算。</p>
            <p>・状態: 草稿(scrape直後) → 確定(爽夏さん確認済) → TKC入力済(杉原さん入力後)</p>
          </div>
        </>
      )}
    </div>
  )
}
