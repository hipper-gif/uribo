// 給与テーブル・ランク閲覧画面（読み取り専用の「器」・2026-09-16）
// 目的: 爽夏さんが「等級表（時期別）」「スタッフ別ランク」「役職手当」を1画面で確認できるようにする。
// データは既存の正本を読むだけ: 等級表=Mneme salary_grades（プロキシ経由）／
// ランク割当=beauty_employee_grade／役職手当=beauty_position_allowance。編集はスコープ外
//（改定は旧行を effective_to で閉じて新行を追加＝上書き禁止。docs/給与データの仕組みメモ.md §4）。
import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '../lib/api'
import { fetchBeautyStaff, fetchSalaryGrades, type MnemeEmployee, type SalaryGrade } from '../lib/mnemeApi'
import './Payroll.css'

interface EmployeeGrade {
  id: number
  employee_id: number
  employment_type: string
  grade: 'A' | 'B' | 'C' | 'D'
  base_salary_override: number | null
  effective_from: string
  effective_to: string | null
  notes: string | null
}

interface PositionAllowance {
  id: number
  position_name: string
  amount: number
  effective_from: string
  effective_to: string | null
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
const today = () => new Date().toISOString().slice(0, 10)
const isActive = (from: string, to: string | null, asOf: string) => from <= asOf && (to === null || to >= asOf)

export default function GradeTable() {
  const [grades, setGrades] = useState<SalaryGrade[]>([])
  const [empGrades, setEmpGrades] = useState<EmployeeGrade[]>([])
  const [positions, setPositions] = useState<PositionAllowance[]>([])
  const [staff, setStaff] = useState<MnemeEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState<string>('')  // 選択中の等級表版（effective_from）
  const [historyFor, setHistoryFor] = useState<number | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [g, eg, pa, st] = await Promise.all([
        fetchSalaryGrades(),
        apiGet<EmployeeGrade[]>('beauty_employee_grade', { order: 'employee_id,effective_from.desc' }),
        apiGet<PositionAllowance[]>('beauty_position_allowance', { order: 'position_name,effective_from.desc' }),
        fetchBeautyStaff(),
      ])
      if (eg.error) setError(eg.error.message)
      setGrades(g)
      setEmpGrades(eg.data ?? [])
      setPositions(pa.data ?? [])
      setStaff(st)
      // 既定の版 = 今日時点で有効な版（無ければ最新）
      const froms = [...new Set(g.map(r => r.effective_from))].sort().reverse()
      const current = froms.find(f => f <= today()) ?? froms[0] ?? ''
      setVersion(current)
      setLoading(false)
    })()
  }, [])

  const versions = useMemo(() => {
    const froms = [...new Set(grades.map(r => r.effective_from))].sort().reverse()
    return froms.map(f => {
      const future = f > today()
      const isCurrent = !future && f === (froms.find(x => x <= today()) ?? '')
      return { from: f, label: `${f.replaceAll('-', '/')}〜${future ? '（予定）' : isCurrent ? '（現行）' : '（過去）'}` }
    })
  }, [grades])

  const shownGrades = useMemo(
    () => grades.filter(r => r.effective_from === version)
      .sort((a, b) => a.employment_type.localeCompare(b.employment_type, 'ja') || a.sort_order - b.sort_order),
    [grades, version],
  )

  const staffName = (id: number) => staff.find(s => s.id === id)?.name ?? `ID:${id}`
  const activeEmpGrades = useMemo(() => {
    const asOf = today()
    return empGrades.filter(r => isActive(r.effective_from, r.effective_to, asOf))
      .sort((a, b) => a.grade.localeCompare(b.grade) || staffName(a.employee_id).localeCompare(staffName(b.employee_id), 'ja'))
  }, [empGrades, staff])

  if (loading) return <div className="payroll-empty">読み込み中…</div>
  if (error) return <div className="payroll-empty">読み込みエラー: {error}（admin ログインが必要です）</div>

  return (
    <div>
      <h2>美容部 給与テーブル・ランク</h2>
      <p style={{ color: 'var(--muted, #888)', fontSize: 13, margin: '4px 0 16px' }}>
        閲覧専用。改定・ランク変更の反映は情シス（星さん）へ。過去の版もこの画面で遡って確認できます。
      </p>

      {/* ① 等級表（時期別） */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>等級表（ランク → 金額）</h3>
          <select value={version} onChange={e => setVersion(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 6 }}>
            {versions.map(v => <option key={v.from} value={v.from}>{v.label}</option>)}
          </select>
        </div>
        <div className="payroll-table-wrap">
          <table className="payroll-table">
            <thead>
              <tr><th>雇用形態</th><th>ランク</th><th className="right">金額</th><th>条件</th></tr>
            </thead>
            <tbody>
              {shownGrades.map(r => (
                <tr key={r.id}>
                  <td>{r.employment_type}（{r.salary_type}）</td>
                  <td><strong>{r.grade}</strong></td>
                  <td className="right"><strong>{yen(r.base_salary)}</strong>{r.salary_type === '時給' ? '/h' : '/月'}</td>
                  <td style={{ fontSize: 12 }}>{r.conditions}</td>
                </tr>
              ))}
              {shownGrades.length === 0 && <tr><td colSpan={4}>この版のデータがありません</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* ② 役職手当 */}
      <section style={{ marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>役職手当</h3>
        <div className="payroll-table-wrap">
          <table className="payroll-table">
            <thead><tr><th>役職</th><th className="right">月額</th><th>適用</th></tr></thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id} style={isActive(p.effective_from, p.effective_to, today()) ? {} : { opacity: 0.5 }}>
                  <td>{p.position_name}</td>
                  <td className="right">{yen(p.amount)}</td>
                  <td style={{ fontSize: 12 }}>{p.effective_from.replaceAll('-', '/')}〜{p.effective_to ? p.effective_to.replaceAll('-', '/') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ③ スタッフ別ランク */}
      <section>
        <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>スタッフ別ランク（現在有効）</h3>
        <div className="payroll-table-wrap">
          <table className="payroll-table">
            <thead>
              <tr><th>スタッフ</th><th>区分</th><th>ランク</th><th>適用開始</th><th className="right">個別調整</th><th>メモ / 履歴</th></tr>
            </thead>
            <tbody>
              {activeEmpGrades.map(r => (
                <>
                  <tr key={r.id}>
                    <td><strong>{staffName(r.employee_id)}</strong></td>
                    <td>{r.employment_type}</td>
                    <td><strong>{r.grade}</strong></td>
                    <td>{r.effective_from.replaceAll('-', '/')}</td>
                    <td className="right">{r.base_salary_override ? `+${yen(r.base_salary_override)}` : '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      <button className="payroll-btn-primary" style={{ minHeight: 24, padding: '2px 10px', marginRight: 8 }}
                        onClick={() => setHistoryFor(historyFor === r.employee_id ? null : r.employee_id)}>
                        履歴{historyFor === r.employee_id ? '▲' : '▼'}
                      </button>
                      {r.notes?.slice(0, 40)}
                    </td>
                  </tr>
                  {historyFor === r.employee_id && empGrades
                    .filter(h => h.employee_id === r.employee_id)
                    .map(h => (
                      <tr key={`h-${h.id}`} style={{ opacity: 0.65, background: 'rgba(128,128,128,0.06)' }}>
                        <td style={{ paddingLeft: 24, fontSize: 12 }}>└ 履歴</td>
                        <td style={{ fontSize: 12 }}>{h.employment_type}</td>
                        <td style={{ fontSize: 12 }}>{h.grade}</td>
                        <td style={{ fontSize: 12 }}>{h.effective_from.replaceAll('-', '/')}〜{h.effective_to ? h.effective_to.replaceAll('-', '/') : '現在'}</td>
                        <td className="right" style={{ fontSize: 12 }}>{h.base_salary_override ? `+${yen(h.base_salary_override)}` : '—'}</td>
                        <td style={{ fontSize: 11 }}>{h.notes}</td>
                      </tr>
                    ))}
                </>
              ))}
              {activeEmpGrades.length === 0 && <tr><td colSpan={6}>ランク割当データがありません</td></tr>}
            </tbody>
          </table>
        </div>
        <p style={{ color: 'var(--muted, #888)', fontSize: 12, marginTop: 8 }}>
          個別調整＝ランク金額への上乗せ（例: 上石田さんの調整手当）。履歴は「いつからいつまでどのランクだったか」の記録で、過去分は消さずに残しています。
        </p>
      </section>
    </div>
  )
}
