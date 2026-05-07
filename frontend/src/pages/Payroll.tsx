import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch } from '../lib/api'
import { fetchBeautyStaff, type MnemeEmployee } from '../lib/mnemeApi'
import './Payroll.css'

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
const STATUS_LABEL: Record<PayrollRow['status'], string> = {
  draft: '草稿',
  confirmed: '確定済',
  tkc_entered: 'TKC入力済',
}

function prevMonth(): { year: number; month: number } {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function fmtYen(n: number | string | null | undefined): string {
  if (n == null || n === '') return '¥0'
  const num = typeof n === 'string' ? Number(n) : n
  if (!Number.isFinite(num)) return '¥0'
  return '¥' + Number(num).toLocaleString()
}

function calcTotal(r: Partial<PayrollRow>): number {
  return (
    (Number(r.base_salary) || 0) +
    (Number(r.commission_amount) || 0) +
    (Number(r.nomination_allowance) || 0) +
    (Number(r.position_allowance) || 0) +
    (Number(r.transit_amount) || 0)
  )
}

interface CommissionRow {
  id: number
  sales_threshold: number
  commission_amount: number
  effective_from: string
  effective_to: string | null
}

function commissionFor(sales: number, table: CommissionRow[]): number {
  // sales_threshold <= sales の中で最大の commission_amount (階段関数)
  let best = 0
  for (const r of table) {
    if (sales >= Number(r.sales_threshold)) {
      const amt = Number(r.commission_amount)
      if (amt > best) best = amt
    }
  }
  return best
}

export function Payroll() {
  const init = prevMonth()
  const [year, setYear] = useState(init.year)
  const [month, setMonth] = useState(init.month)
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [staff, setStaff] = useState<MnemeEmployee[]>([])
  const [commissionTable, setCommissionTable] = useState<CommissionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<Partial<PayrollRow>>({})
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [viewMode, setViewMode] = useState<'card' | 'table'>(() => {
    const saved = localStorage.getItem('payroll_view_mode')
    return saved === 'table' ? 'table' : 'card'
  })
  const [storeFilter, setStoreFilter] = useState<'all' | 1 | 2>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | PayrollRow['status']>('all')

  function changeView(m: 'card' | 'table') {
    setViewMode(m)
    localStorage.setItem('payroll_view_mode', m)
  }

  const [syncRunning, setSyncRunning] = useState(false)

  function startStatusPolling() {
    setSyncRunning(true)
    const intervalId = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:8765/status')
        if (!res.ok) return
        const data = await res.json()
        if (!data.running) {
          clearInterval(intervalId)
          setSyncRunning(false)
          if (data.returncode === 0) {
            // 自動でデータ再読み込み
            await load()
            alert('✅ サロンボード取得完了！画面を更新しました。')
          } else {
            const tail = (data.log_tail || []).slice(-15).join('\n')
            alert(`⚠ 実行終了 (rc=${data.returncode})\n\n最終ログ:\n${tail}`)
          }
        }
      } catch {/* ignore - server may be down */}
    }, 3000)
    // 5分でタイムアウト
    setTimeout(() => {
      clearInterval(intervalId)
      setSyncRunning(false)
    }, 5 * 60 * 1000)
  }

  const empMap = useMemo(() => {
    const m: Record<number, MnemeEmployee> = {}
    for (const s of staff) m[s.id] = s
    return m
  }, [staff])

  function toggleExpand(id: number) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function openMonthPdf() {
    const apiUrl = (import.meta.env.VITE_API_URL as string).replace('/api.php', '')
    const token = import.meta.env.VITE_API_TOKEN as string
    try {
      const res = await fetch(`${apiUrl}/payroll_pdf.php?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        alert(`PDF取得失敗: HTTP ${res.status}\n（まだサーバーに反映されていない可能性）`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      alert('PDF取得エラー: ' + (err as Error).message)
    }
  }

  async function load() {
    setLoading(true)
    setError(null)
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-31`
    const [{ data, error: e1 }, st, ct] = await Promise.all([
      apiGet<PayrollRow[]>('beauty_payroll_monthly', {
        year: `eq.${year}`,
        month: `eq.${month}`,
        order: 'store_id.asc,total_amount.desc',
      }),
      fetchBeautyStaff(),
      apiGet<CommissionRow[]>('beauty_commission_table', {
        effective_from: `lte.${monthEnd}`,
        order: 'sales_threshold.asc',
      }),
    ])
    if (e1) setError(e1.message)
    setRows(data ?? [])
    setStaff(st)
    // 月時点で有効な行のみ
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    setCommissionTable((ct.data ?? []).filter(r => r.effective_to === null || r.effective_to >= monthStart))
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  function startEdit(r: PayrollRow) {
    setEditing(r.id)
    setDraft({
      sales_total: r.sales_total,
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
    const sales = Number(draft.sales_total ?? orig.sales_total) || 0
    merged.sales_total = sales
    // 売上→歩合(自動再計算)
    merged.commission_amount = commissionFor(sales, commissionTable)
    const nomActual = Number(draft.nomination_count_actual ?? orig.nomination_count_actual) || 0
    merged.nomination_count_actual = nomActual
    merged.nomination_allowance = nomActual * 500
    merged.perfect_attendance_accrual = (Number(draft.perfect_attendance) || 0) ? 5000 : 0
    merged.total_amount = calcTotal(merged)

    const patch: Record<string, unknown> = {
      sales_total: merged.sales_total,
      commission_amount: merged.commission_amount,
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
    if (!confirm(`${empMap[r.employee_id]?.name ?? r.employee_id} を「${STATUS_LABEL[to]}」に変更します。よろしいですか？`)) return
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

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (storeFilter !== 'all' && r.store_id !== storeFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      return true
    })
  }, [rows, storeFilter, statusFilter])

  const totalSales = filteredRows.reduce((s, r) => s + (r.sales_total || 0), 0)
  const totalPay = filteredRows.reduce((s, r) => s + (r.total_amount || 0), 0)

  return (
    <div className="payroll-page">
      <div className="payroll-header">
        <h2>美容部 給与計算</h2>
        <div className="payroll-controls">
          <select
            className="payroll-month-select"
            value={`${year}-${month}`}
            onChange={e => {
              const [y, m] = e.target.value.split('-').map(Number)
              setYear(y); setMonth(m)
            }}
          >
            {monthOptions.map(o => (
              <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>
                {o.y}年{o.m}月分
              </option>
            ))}
          </select>
          <button className="payroll-btn-primary" onClick={load}>更新</button>
          <button className="payroll-btn-secondary" onClick={openMonthPdf}>📄 給与明細PDF</button>
        </div>
      </div>

      {error && <div className="payroll-error">{error}</div>}
      {loading && <div>読み込み中...</div>}

      {!loading && rows.length === 0 && (() => {
        const today = new Date()
        const executableFrom = new Date(year, month, 1) // y年m月の翌月1日
        const isExecutable = today >= executableFrom
        const monthStr = `${year}-${String(month).padStart(2, '0')}`
        const cmd = `cd C:\\Users\\nikon\\projects\\uribo\\scripts; python sync_salonboard.py --with-staff --month ${monthStr}`

        async function runSync() {
          // ローカルランナーへ実行依頼
          try {
            const res = await fetch('http://localhost:8765/sync', {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ month: monthStr, mode: 'with-staff' }),
            })
            if (res.status === 202) {
              alert('🚀 実行を開始しました\n\nサロンボードのブラウザが立ち上がります。\n• CAPTCHAが出たら手動で解いてください\n• 完了後（1-2分）、この画面の「更新」をクリック')
              startStatusPolling()
              return
            }
            if (res.status === 409) {
              alert('既に実行中です。完了までお待ちください。')
              return
            }
            throw new Error('HTTP ' + res.status)
          } catch (err) {
            // ローカルランナー未起動 → クリップボードフォールバック
            try {
              await navigator.clipboard.writeText(cmd)
            } catch {/* ignore */}
            const setup = confirm(
              'ローカルランナーが起動していません\n\n' +
              '【今すぐ手動実行】OKを押してこの後の手順:\n' +
              '  1. PowerShellを開く\n' +
              '  2. クリップボードにコピー済みのコマンドを貼り付け\n' +
              '  3. CAPTCHAを解いて完了\n\n' +
              '【ワンクリック実行を有効化】キャンセルを押すと方法を表示'
            )
            if (!setup) {
              alert(
                '🛠 ローカルランナー初期セットアップ\n\n' +
                '管理者権限のPowerShellで一度だけ実行:\n' +
                '  powershell -ExecutionPolicy Bypass -File ' +
                'C:\\Users\\nikon\\projects\\uribo\\scripts\\register_local_runner.ps1\n\n' +
                '次回ログオン時から自動でlocalhost:8765が起動します。\n' +
                '今すぐ起動: start_local_runner.bat をダブルクリック'
              )
            }
          }
        }

        return (
          <div className="payroll-empty">
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>{year}年{month}月分のデータはまだ投入されていません</h3>
            {isExecutable ? (
              <>
                <button className="payroll-btn-primary" onClick={runSync} disabled={syncRunning} style={{ fontSize: 15, padding: '12px 24px' }}>
                  {syncRunning ? '⏳ 実行中... (サロンボードのブラウザで操作してください)' : '📥 サロンボードから取得して投入'}
                </button>
                <p style={{ marginTop: 16, fontSize: 12, color: '#888', textAlign: 'left', lineHeight: 1.6 }}>
                  ※ ローカルランナー(localhost:8765)が起動していれば、このボタンで直接実行されます。<br/>
                  起動していない場合は手動実行用コマンドがクリップボードにコピーされます。
                </p>
              </>
            ) : (
              <p style={{ color: '#888' }}>
                <b>{executableFrom.getFullYear()}年{executableFrom.getMonth() + 1}月{executableFrom.getDate()}日</b> 以降に投入可能になります<br/>
                <small style={{ fontSize: 11 }}>（{month}月の売上データが月末確定後にしか取得できないため）</small>
              </p>
            )}
          </div>
        )
      })()}

      {!loading && rows.length > 0 && (
        <>
          <div className="payroll-summary">
            <span>対象 <b>{filteredRows.length}</b>名{filteredRows.length !== rows.length ? `(全${rows.length}名中)` : ''}</span>
            <span>売上合計 <b>{fmtYen(totalSales)}</b></span>
            <span>支給合計 <b>{fmtYen(totalPay)}</b></span>
          </div>

          <div className="payroll-toolbar">
            <div className="payroll-filter-group">
              <span className="payroll-filter-label">店舗</span>
              <button className={`payroll-chip ${storeFilter === 'all' ? 'active' : ''}`} onClick={() => setStoreFilter('all')}>全店</button>
              <button className={`payroll-chip ${storeFilter === 1 ? 'active' : ''}`} onClick={() => setStoreFilter(1)}>寝屋川</button>
              <button className={`payroll-chip ${storeFilter === 2 ? 'active' : ''}`} onClick={() => setStoreFilter(2)}>守口</button>
            </div>
            <div className="payroll-filter-group">
              <span className="payroll-filter-label">状態</span>
              <button className={`payroll-chip ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>全て</button>
              <button className={`payroll-chip ${statusFilter === 'draft' ? 'active' : ''}`} onClick={() => setStatusFilter('draft')}>草稿</button>
              <button className={`payroll-chip ${statusFilter === 'confirmed' ? 'active' : ''}`} onClick={() => setStatusFilter('confirmed')}>確定済</button>
              <button className={`payroll-chip ${statusFilter === 'tkc_entered' ? 'active' : ''}`} onClick={() => setStatusFilter('tkc_entered')}>TKC入力済</button>
            </div>
            <div className="payroll-spacer"></div>
            <div className="payroll-view-toggle">
              <button className={viewMode === 'card' ? 'active' : ''} onClick={() => changeView('card')}>📇 カード</button>
              <button className={viewMode === 'table' ? 'active' : ''} onClick={() => changeView('table')}>📋 一覧</button>
            </div>
          </div>

          {filteredRows.length === 0 ? (
            <div className="payroll-empty">フィルタ条件に該当するスタッフがいません</div>
          ) : viewMode === 'table' ? (
            <div className="payroll-table-wrap">
              <table className="payroll-table">
                <thead>
                  <tr>
                    <th>店</th>
                    <th>スタッフ</th>
                    <th className="right">売上</th>
                    <th className="right">歩合</th>
                    <th className="right">指名</th>
                    <th className="right">指名手当</th>
                    <th className="right">基本給</th>
                    <th className="right">役職</th>
                    <th className="right">交通費</th>
                    <th className="right">立替</th>
                    <th className="right">合計</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(r => {
                    const isEdit = editing === r.id
                    const e = empMap[r.employee_id]
                    const status = r.status
                    return (
                      <tr key={r.id}>
                        <td>{STORE_LABEL[r.store_id]}</td>
                        <td><b>{e?.name ?? `(emp=${r.employee_id})`}</b></td>
                        <td className="right">
                          {isEdit ? (
                            <input className="payroll-table-input" type="number" min="0" step="100"
                              value={String(draft.sales_total ?? r.sales_total)}
                              onChange={ev => setDraft(d => ({ ...d, sales_total: Number(ev.target.value) || 0 }))}
                              style={{ width: 100 }}
                            />
                          ) : fmtYen(r.sales_total)}
                        </td>
                        <td className="right">{fmtYen(isEdit ? commissionFor(Number(draft.sales_total ?? r.sales_total) || 0, commissionTable) : r.commission_amount)}</td>
                        <td className="right">
                          {isEdit ? (
                            <input className="payroll-table-input" type="number" min="0"
                              value={String(draft.nomination_count_actual ?? r.nomination_count_actual)}
                              onChange={ev => setDraft(d => ({ ...d, nomination_count_actual: Number(ev.target.value) || 0 }))}
                            />
                          ) : (
                            <>{r.nomination_count_actual}件</>
                          )}
                        </td>
                        <td className="right">{fmtYen(isEdit ? (Number(draft.nomination_count_actual ?? r.nomination_count_actual) || 0) * 500 : r.nomination_allowance)}</td>
                        <td className="right">{fmtYen(r.base_salary)}</td>
                        <td className="right">{fmtYen(r.position_allowance)}</td>
                        <td className="right">
                          {isEdit ? (
                            <input className="payroll-table-input" type="number" min="0"
                              value={String(draft.transit_amount ?? r.transit_amount)}
                              onChange={ev => setDraft(d => ({ ...d, transit_amount: Number(ev.target.value) || 0 }))}
                            />
                          ) : fmtYen(r.transit_amount)}
                        </td>
                        <td className="right">
                          {isEdit ? (
                            <input className="payroll-table-input" type="number" min="0"
                              value={String(draft.reimbursement ?? r.reimbursement)}
                              onChange={ev => setDraft(d => ({ ...d, reimbursement: Number(ev.target.value) || 0 }))}
                            />
                          ) : fmtYen(r.reimbursement)}
                        </td>
                        <td className="right strong">{fmtYen(isEdit ? calcTotal({
                          ...r, ...draft,
                          sales_total: Number(draft.sales_total ?? r.sales_total) || 0,
                          commission_amount: commissionFor(Number(draft.sales_total ?? r.sales_total) || 0, commissionTable),
                          nomination_allowance: (Number(draft.nomination_count_actual ?? r.nomination_count_actual) || 0) * 500,
                        }) : r.total_amount)}</td>
                        <td>
                          <span className={`payroll-status-badge payroll-status-${status}`}>
                            {STATUS_LABEL[status]}
                          </span>
                        </td>
                        <td className="payroll-table-actions">
                          {isEdit ? (
                            <>
                              <button className="payroll-btn-primary" onClick={() => saveEdit(r)} style={{ minHeight: 30, padding: '4px 10px' }}>保存</button>
                              <button className="payroll-btn-secondary" onClick={cancelEdit} style={{ minHeight: 30, padding: '4px 10px' }}>取消</button>
                            </>
                          ) : (
                            <>
                              <button className="payroll-btn-secondary" onClick={() => startEdit(r)} style={{ minHeight: 30, padding: '4px 10px' }}>編集</button>
                              {status === 'draft' && (
                                <button className="payroll-btn-primary" onClick={() => transition(r, 'confirmed')} style={{ minHeight: 30, padding: '4px 10px' }}>確定</button>
                              )}
                              {status === 'confirmed' && (
                                <button className="payroll-btn-tkc" onClick={() => transition(r, 'tkc_entered')} style={{ minHeight: 30, padding: '4px 10px' }}>TKC済</button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="payroll-cards">
            {filteredRows.map(r => {
              const isEdit = editing === r.id
              const e = empMap[r.employee_id]
              const status = r.status
              const editedSales = Number(draft.sales_total ?? r.sales_total) || 0
              const editedCommission = isEdit ? commissionFor(editedSales, commissionTable) : r.commission_amount
              const computedTotal = isEdit
                ? calcTotal({
                    ...r,
                    ...draft,
                    sales_total: editedSales,
                    commission_amount: editedCommission,
                    nomination_allowance: (Number(draft.nomination_count_actual ?? r.nomination_count_actual) || 0) * 500,
                  })
                : r.total_amount
              return (
                <div key={r.id} className="payroll-card">
                  <div className="payroll-card-head">
                    <div className="payroll-card-head-left">
                      <span className="payroll-store-pill">{STORE_LABEL[r.store_id]}</span>
                      <span className="payroll-name">{e?.name ?? `(emp=${r.employee_id})`}</span>
                    </div>
                    <span className={`payroll-status-badge payroll-status-${status}`}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>

                  <div className="payroll-row">
                    <span className="payroll-row-label">売上</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" min="0" step="100"
                          value={String(draft.sales_total ?? r.sales_total)}
                          onChange={ev => setDraft(d => ({ ...d, sales_total: Number(ev.target.value) || 0 }))}
                          style={{ width: 110 }}
                        />
                      ) : fmtYen(r.sales_total)}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">歩合(達成金)</span>
                    <span className="payroll-row-value">{fmtYen(editedCommission)}{isEdit && Number(draft.sales_total ?? r.sales_total) !== r.sales_total && <span className="payroll-row-sub">自動再計算</span>}</span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">指名件数</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" min="0"
                          value={String(draft.nomination_count_actual ?? r.nomination_count_actual)}
                          onChange={ev => setDraft(d => ({ ...d, nomination_count_actual: Number(ev.target.value) || 0 }))}
                        />
                      ) : (
                        <>{r.nomination_count_actual}件<span className="payroll-row-sub">/SB:{r.nomination_count_scraped}</span></>
                      )}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">指名手当</span>
                    <span className="payroll-row-value">{fmtYen(isEdit ? (Number(draft.nomination_count_actual ?? r.nomination_count_actual) || 0) * 500 : r.nomination_allowance)}</span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">基本給</span>
                    <span className="payroll-row-value">{fmtYen(r.base_salary)}</span>
                  </div>
                  {(r.position_allowance > 0 || isEdit) && (
                    <div className="payroll-row">
                      <span className="payroll-row-label">役職手当</span>
                      <span className="payroll-row-value">{fmtYen(r.position_allowance)}</span>
                    </div>
                  )}

                  <div className="payroll-row">
                    <span className="payroll-row-label">交通費</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" min="0"
                          value={String(draft.transit_amount ?? r.transit_amount)}
                          onChange={ev => setDraft(d => ({ ...d, transit_amount: Number(ev.target.value) || 0 }))}
                        />
                      ) : fmtYen(r.transit_amount)}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">立替金</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" min="0"
                          value={String(draft.reimbursement ?? r.reimbursement)}
                          onChange={ev => setDraft(d => ({ ...d, reimbursement: Number(ev.target.value) || 0 }))}
                        />
                      ) : fmtYen(r.reimbursement)}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">有給</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" step="0.5" min="0"
                          value={String(draft.paid_leave_days ?? r.paid_leave_days)}
                          onChange={ev => setDraft(d => ({ ...d, paid_leave_days: ev.target.value }))}
                        />
                      ) : `${(Number(r.paid_leave_days) || 0).toFixed(1)}日`}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">残業</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input className="payroll-input" type="number" step="0.25" min="0"
                          value={String(draft.overtime_hours ?? r.overtime_hours)}
                          onChange={ev => setDraft(d => ({ ...d, overtime_hours: ev.target.value }))}
                        />
                      ) : `${(Number(r.overtime_hours) || 0).toFixed(2)}h`}
                    </span>
                  </div>
                  <div className="payroll-row">
                    <span className="payroll-row-label">皆勤(積立)</span>
                    <span className="payroll-row-value">
                      {isEdit ? (
                        <input type="checkbox" className="payroll-checkbox"
                          checked={!!(draft.perfect_attendance ?? r.perfect_attendance)}
                          onChange={ev => setDraft(d => ({ ...d, perfect_attendance: ev.target.checked ? 1 : 0 }))}
                        />
                      ) : (r.perfect_attendance ? '◯ 達成' : '—')}
                    </span>
                  </div>

                  <div className="payroll-total">
                    <span className="payroll-total-label">合計</span>
                    <span className="payroll-total-value">{fmtYen(computedTotal)}</span>
                  </div>

                  <div className="payroll-actions">
                    {isEdit ? (
                      <>
                        <button className="payroll-btn-primary" onClick={() => saveEdit(r)}>保存</button>
                        <button className="payroll-btn-secondary" onClick={cancelEdit}>取消</button>
                      </>
                    ) : (
                      <>
                        <button className="payroll-btn-secondary" onClick={() => toggleExpand(r.id)}>
                          {expanded.has(r.id) ? '閉じる' : '明細'}
                        </button>
                        <button className="payroll-btn-secondary" onClick={() => startEdit(r)}>編集</button>
                        {status === 'draft' && (
                          <button className="payroll-btn-primary" onClick={() => transition(r, 'confirmed')}>確定</button>
                        )}
                        {status === 'confirmed' && (
                          <button className="payroll-btn-tkc" onClick={() => transition(r, 'tkc_entered')}>TKC入力済</button>
                        )}
                      </>
                    )}
                  </div>

                  {expanded.has(r.id) && (
                    <div className="payroll-detail">
                      <h4>TKC明細（PDF反映）</h4>
                      {r.tkc_verified_at ? (
                        <table>
                          <tbody>
                            <tr><td className="label">支給合計</td><td className="value">{fmtYen(r.gross_total)}</td></tr>
                            <tr><td className="label">社会保険料</td><td className="value">{fmtYen(r.social_insurance_total)}</td></tr>
                            <tr><td className="label">所得税</td><td className="value">{fmtYen(r.income_tax)}</td></tr>
                            <tr><td className="label">住民税</td><td className="value">{fmtYen(r.resident_tax)}</td></tr>
                            <tr className="highlight"><td className="label">差引支給額</td><td className="value">{fmtYen(r.net_payment)}</td></tr>
                          </tbody>
                        </table>
                      ) : (
                        <div style={{ color: '#999', fontSize: 12 }}>まだPDF反映されていません</div>
                      )}

                      <h4>サロンボード参考値</h4>
                      <table>
                        <tbody>
                          <tr><td className="label">総売上</td><td className="value">{fmtYen(r.sales_total)}</td></tr>
                          <tr><td className="label">　施術</td><td className="value">{fmtYen(r.sales_treatment)}</td></tr>
                          <tr><td className="label">　店販</td><td className="value">{fmtYen(r.sales_product)}</td></tr>
                          <tr><td className="label">　オプション</td><td className="value">{fmtYen(r.sales_option)}</td></tr>
                          <tr><td className="label">客数</td><td className="value">{r.customers_total} (新{r.customers_new}/再{r.customers_repeat})</td></tr>
                          <tr><td className="label">指名売上</td><td className="value">{fmtYen(r.nomination_sales)}</td></tr>
                        </tbody>
                      </table>

                      {r.tkc_pdf_filename && r.tkc_verified_at && (
                        <div className="payroll-detail-meta">
                          反映: {r.tkc_pdf_filename} ({r.tkc_verified_at.slice(0, 16)})
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          )}

          <div className="payroll-help">
            <p>・指名件数を編集すると、指名手当(×¥500)・合計を自動再計算します</p>
            <p>・パート(時給制)の基本給は¥0表示。時給×勤務時間はTKC側で確定</p>
            <p>・皆勤手当 ¥5,000は積立、月次合計には含めず賞与で精算</p>
            <p>・状態: 草稿(scrape直後) → 確定(爽夏さん確認済) → TKC入力済(杉原さん入力後)</p>
            <p>・上部の「📄 給与明細PDF」ボタンで、選択月の全員分PDFを開けます</p>
          </div>
        </>
      )}
    </div>
  )
}
