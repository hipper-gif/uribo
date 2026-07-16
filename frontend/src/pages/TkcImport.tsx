import { useState, useMemo, useEffect, useCallback } from 'react'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { useStores, useMonthlyHistory } from '../lib/useBeautyData'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatAmount } from '../lib/types'
import type { BeautyItemMaster, BeautyMonthlyData, DataType } from '../lib/types'
import {
  parseJournalCsv, aggregateBeauty, TKC_RULES, buildDraftAssignments,
  classifyOutsourcing, classifyOutsourcingBreakdown,
  type AggregatedEntry, type AssignmentDraft, type OutsourcingKind, type ParsedJournalRowWithTrader,
} from '../lib/tkcImport'
import { auditImport, type AuditFinding } from '../lib/tkcAudit'

interface PreviewRow {
  entry: AggregatedEntry
  drafts: AssignmentDraft[]
  /** チェック: この行を取込対象とする */
  selected: boolean
  /** 未マッピング(対応itemなし) */
  unmapped: boolean
  /** スキップ対象(BS科目等) */
  skipped: boolean
}

interface TkcImportProps {
  /** 外部から月・年・データ区分を制御したい場合(統合モード用) */
  initialFiscalYear?: number
  initialMonth?: number
  initialDataType?: DataType
  /** 反映完了後のコールバック(モーダル閉じる等) */
  onComplete?: () => void
  /** モーダル統合モードか(ナビ・タイトル等の見た目を変える) */
  embedded?: boolean
}

export function TkcImport({ initialFiscalYear, initialMonth, initialDataType, onComplete, embedded }: TkcImportProps = {}) {
  const stores = useStores()
  const [allItems, setAllItems] = useState<BeautyItemMaster[]>([])
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [month, setMonth] = useState(initialMonth ?? 4)
  const [fiscalYear, setFiscalYear] = useState(initialFiscalYear ?? currentFiscalYear())
  const [dataType] = useState<DataType>(initialDataType ?? '実績')
  const [existingData, setExistingData] = useState<BeautyMonthlyData[]>([])
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([])
  const [journal, setJournal] = useState<ParsedJournalRowWithTrader[]>([])
  const [executing, setExecuting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [auditOverride, setAuditOverride] = useState(false)
  /** 6117明細区分の手動上書き。キー=`${month}|${store_id}|${detailIdx}`(月替わりで自然に無効化) */
  const [kind6117, setKind6117] = useState<Record<string, OutsourcingKind>>({})
  const { history } = useMonthlyHistory(fiscalYear)

  // 全itemを取得(is_active=0も含む)
  useEffect(() => {
    apiGet<BeautyItemMaster[]>('beauty_item_master', { select: '*', order: 'sort_order' })
      .then(r => { if (r.data) setAllItems(r.data) })
  }, [])

  const itemByCode = useMemo(() => {
    const m: Record<string, { id: number; item_code: string }> = {}
    for (const it of allItems) m[it.item_code] = { id: it.id, item_code: it.item_code }
    return m
  }, [allItems])

  const itemById = useMemo(() => {
    const m: Record<number, BeautyItemMaster> = {}
    for (const it of allItems) m[it.id] = it
    return m
  }, [allItems])

  // 既存データを取得(対象月×全店舗×実績)
  const reloadExisting = useCallback(async () => {
    const r = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
      select: '*', fiscal_year: `eq.${fiscalYear}`, month: `eq.${month}`, data_type: `eq.${dataType}`,
    })
    if (r.data) setExistingData(r.data)
  }, [fiscalYear, month, dataType])

  useEffect(() => { reloadExisting() }, [reloadExisting])

  const existingByStoreItem = useMemo(() => {
    const m: Record<string, { id: number; amount: number }> = {}
    for (const d of existingData) m[`${d.store_id}|${d.item_id}`] = { id: d.id, amount: parseFloat(d.amount) }
    return m
  }, [existingData])

  // CSV パース → プレビュー構築
  const buildPreview = useCallback((text: string, kinds: Record<string, OutsourcingKind> = kind6117) => {
    setError('')
    try {
      const parsed = parseJournalCsv(text)
      if (parsed.length === 0) { setError('仕訳行が検出できませんでした'); return }
      setJournal(parsed)
      const entries = aggregateBeauty(parsed, month)
      const kindOf6117 = (e: AggregatedEntry, i: number) => kinds[`${month}|${e.store_id}|${i}`]
      const rows: PreviewRow[] = entries.map(e => {
        const rule = TKC_RULES[e.tkc_code]
        const skipped = rule?.skip ?? false
        const unmapped = !rule || (rule.uribo_codes.length === 0 && !skipped)
        const drafts = (!skipped && rule)
          ? buildDraftAssignments({ entry: e, itemByCode, existingByStoreItem, allEntries: entries, kindOf6117 })
          : []
        return { entry: e, drafts, selected: !skipped && !unmapped, unmapped, skipped }
      })
      setPreviewRows(rows)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [month, itemByCode, existingByStoreItem, kind6117])

  // 既存データ・月・itemMaster更新時にプレビュー再構築
  useEffect(() => {
    if (csvText && Object.keys(itemByCode).length > 0) buildPreview(csvText)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, existingData, allItems])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => {
      const txt = reader.result as string
      setCsvText(txt)
      setKind6117({})  // 別ファイルでは明細indexがズレるため上書きをリセット
      buildPreview(txt, {})
    }
    reader.readAsText(f, 'utf-8')
  }

  /** 6117明細の区分を手動変更 → 6117行のdraftsのみ再構築(他行の手編集・チェックは保持) */
  const changeKind6117 = (storeId: number, detailIdx: number, kind: OutsourcingKind) => {
    const next = { ...kind6117, [`${month}|${storeId}|${detailIdx}`]: kind }
    setKind6117(next)
    setPreviewRows(rows => {
      const entries = rows.map(r => r.entry)
      const kindOf6117 = (e: AggregatedEntry, i: number) => next[`${month}|${e.store_id}|${i}`]
      return rows.map(r => r.entry.tkc_code === '6117'
        ? { ...r, drafts: buildDraftAssignments({ entry: r.entry, itemByCode, existingByStoreItem, allEntries: entries, kindOf6117 }) }
        : r)
    })
  }

  const updateDraftAmount = (rowIdx: number, draftIdx: number, val: string) => {
    const next = [...previewRows]
    next[rowIdx] = { ...next[rowIdx], drafts: [...next[rowIdx].drafts] }
    next[rowIdx].drafts[draftIdx] = { ...next[rowIdx].drafts[draftIdx], amount: parseFloat(val) || 0 }
    setPreviewRows(next)
  }

  const toggleSelected = (rowIdx: number) => {
    const next = [...previewRows]
    next[rowIdx] = { ...next[rowIdx], selected: !next[rowIdx].selected }
    setPreviewRows(next)
  }

  const sumDrafts = (drafts: AssignmentDraft[]) => drafts.reduce((s, d) => s + d.amount, 0)

  const handleExecute = async () => {
    setExecuting(true)
    setMessage(null)
    try {
      // 同一(store,item)のdraftを合算してから書き込む
      // (例: 6212従業員給与 + 6117和田委託 → 守口 salary_total に合算)
      const agg = new Map<string, { store_id: number; item_id: number; amount: number; existing_row_id: number | null }>()
      for (const row of previewRows) {
        if (!row.selected) continue
        for (const d of row.drafts) {
          if (!d.item_id) continue
          const k = `${d.store_id}|${d.item_id}`
          const e = agg.get(k)
          if (e) {
            e.amount += d.amount
            if (e.existing_row_id === null) e.existing_row_id = d.existing_row_id
          } else {
            agg.set(k, { store_id: d.store_id, item_id: d.item_id, amount: d.amount, existing_row_id: d.existing_row_id })
          }
        }
      }
      const promises: Promise<unknown>[] = []
      let count = 0
      for (const e of agg.values()) {
        if (e.amount === 0 && e.existing_row_id === null) continue
        if (e.existing_row_id !== null) {
          promises.push(apiPatch('beauty_monthly_data', { id: `eq.${e.existing_row_id}` }, { amount: e.amount }))
        } else {
          promises.push(apiPost('beauty_monthly_data', {
            store_id: e.store_id, fiscal_year: fiscalYear, month, data_type: dataType,
            item_id: e.item_id, amount: e.amount,
          }))
        }
        count++
      }
      await Promise.all(promises)
      setMessage({ type: 'success', text: `${count}件 反映しました` })
      await reloadExisting()
      if (onComplete) onComplete()
    } catch (e) {
      setMessage({ type: 'error', text: '反映に失敗: ' + (e as Error).message })
    } finally {
      setExecuting(false)
    }
  }

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t) }
  }, [message])

  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)
  const groupedByStore = useMemo(() => {
    const g: Record<number, PreviewRow[]> = {}
    for (const r of previewRows) {
      if (!g[r.entry.store_id]) g[r.entry.store_id] = []
      g[r.entry.store_id].push(r)
    }
    return g
  }, [previewRows])

  const totalSelected = previewRows.filter(r => r.selected).reduce((s, r) => s + r.drafts.length, 0)

  // 異常検知(「ここおかしくない?」ゲート)
  const findings = useMemo<AuditFinding[]>(() => {
    if (previewRows.length === 0 || allItems.length === 0) return []
    const storeIds = stores.filter(s => s.is_active).map(s => s.id)
    return auditImport({
      rows: previewRows.map(r => ({ entry: r.entry, drafts: r.drafts, selected: r.selected })),
      journal, existing: existingData, history, items: allItems,
      fiscalYear, month, storeIds: storeIds.length ? storeIds : [1, 2],
    })
  }, [previewRows, journal, existingData, history, allItems, fiscalYear, month, stores])

  const blockingFindings = findings.filter(f => f.severity === 'blocking')
  const warningFindings = findings.filter(f => f.severity === 'warning')
  const gateBlocked = blockingFindings.length > 0 && !auditOverride
  // 月・CSVが変わったらゲート解除をリセット
  useEffect(() => { setAuditOverride(false) }, [csvText, month, fiscalYear])

  return (
    <div>
      {!embedded && (
        <div className="page-head">
          <div>
            <div className="page-title-row">
              <span className="page-index">— ★ / TKC IMPORT</span>
              <h1 className="page-title">TKCインポート</h1>
            </div>
            <div className="page-subtitle">TKC仕訳帳CSVから美容部門(011/012)を抽出してうりぼーに反映</div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <select className="select" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
        <select className="select" value={month} onChange={e => setMonth(Number(e.target.value))}>
          {FISCAL_MONTHS.map(m => <option key={m} value={m}>{MONTH_LABELS[m]}</option>)}
        </select>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          <input type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
          仕訳帳CSV選択
        </label>
        {fileName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{fileName}</span>}
      </div>

      {error && <div style={{ color: 'var(--negative)', padding: 12 }}>{error}</div>}

      {previewRows.length === 0 ? (
        <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>
          仕訳帳CSV(UTF-8)を選択してください
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {findings.length > 0 && (
            <div className="card" style={blockingFindings.length ? { borderColor: 'var(--negative)' } : undefined}>
              <div className="card-head">
                <div className="card-title">
                  <span className="index">!?</span>ここおかしくない? チェック
                </div>
                <span className="chip" style={blockingFindings.length ? { color: 'var(--negative)' } : undefined}>
                  {blockingFindings.length ? `要対応 ${blockingFindings.length}件` : `注意 ${warningFindings.length}件`}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
                {findings.map((f, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
                    <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                      color: '#fff', background: f.severity === 'blocking' ? 'var(--negative)' : 'var(--warning, #c08a00)',
                    }}>{f.severity === 'blocking' ? '要対応' : '注意'}</span>
                    <span className="chip" style={{ flexShrink: 0, fontSize: 9 }}>{f.group === 'journal' ? '仕訳の疑い' : '取込結果'}</span>
                    <div>
                      <div style={{ fontWeight: 600 }}>{f.rule} · {f.title}</div>
                      <div style={{ color: 'var(--ink-3)', lineHeight: 1.4 }}>{f.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
              {blockingFindings.length > 0 && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, fontSize: 12, color: 'var(--negative)' }}>
                  <input type="checkbox" checked={auditOverride} onChange={e => setAuditOverride(e.target.checked)} />
                  「要対応」を確認した上で反映する(理由を把握済み)
                </label>
              )}
            </div>
          )}
          {stores.filter(s => groupedByStore[s.id]).map(store => (
            <div className="card" key={store.id}>
              <div className="card-head">
                <div className="card-title">
                  <span className="index">{String(store.id).padStart(2, '0')}</span>{store.name}
                </div>
                <span className="chip">{groupedByStore[store.id].filter(r => !r.skipped && !r.unmapped).length}科目</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tkc-import-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}></th>
                      <th>TKC科目</th>
                      <th style={{ textAlign: 'right' }}>TKC値(税込)</th>
                      <th>うりぼーitem</th>
                      <th style={{ textAlign: 'right' }}>既存値</th>
                      <th style={{ textAlign: 'right' }}>反映値</th>
                      <th style={{ textAlign: 'right' }}>差分</th>
                      <th>備考</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupedByStore[store.id].map((row) => {
                      const globalIdx = previewRows.indexOf(row)
                      const rule = TKC_RULES[row.entry.tkc_code]
                      const sumD = sumDrafts(row.drafts)
                      const diff = sumD - row.entry.amount_incl
                      return (
                        <tr key={`${store.id}-${row.entry.tkc_code}`}
                            style={row.skipped ? { opacity: 0.5 } : row.unmapped ? { background: 'rgba(255,200,100,0.1)' } : undefined}>
                          <td>
                            {!row.skipped && !row.unmapped && (
                              <input type="checkbox" checked={row.selected} onChange={() => toggleSelected(globalIdx)} />
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 500 }}>{row.entry.tkc_code} {row.entry.tkc_name}</div>
                            {row.skipped && <div style={{ fontSize: 10, color: 'var(--ink-3)' }}>(対象外)</div>}
                            {row.unmapped && <div style={{ fontSize: 10, color: 'var(--negative)' }}>未マッピング</div>}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right', fontWeight: 500 }}>{formatAmount(row.entry.amount_incl)}</td>
                          <td>
                            {row.drafts.map((d, di) => {
                              const it = d.item_id ? itemById[d.item_id] : null
                              const targetStore = stores.find(s => s.id === d.store_id)
                              const crossStore = d.store_id !== row.entry.store_id
                              return (
                                <div key={di} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                                  <span style={{ fontSize: 12, minWidth: 120 }}>
                                    {it ? `${it.item_code} (${it.item_name})` : <span style={{ color: 'var(--negative)' }}>{d.item_code} 未登録</span>}
                                    {crossStore && targetStore && <span className="chip" style={{ marginLeft: 4, fontSize: 9 }}>→{targetStore.name}</span>}
                                  </span>
                                </div>
                              )
                            })}
                            {row.drafts.length === 0 && !row.skipped && <span style={{ color: 'var(--negative)', fontSize: 12 }}>—</span>}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right' }}>
                            {row.drafts.map((d, di) => (
                              <div key={di} style={{ padding: '2px 0', fontSize: 12, color: 'var(--ink-3)' }}>
                                {d.existing_amount !== null ? formatAmount(d.existing_amount) : '—'}
                              </div>
                            ))}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {row.drafts.map((d, di) => (
                              <div key={di} style={{ padding: '2px 0' }}>
                                <input type="number" value={d.amount} onChange={e => updateDraftAmount(globalIdx, di, e.target.value)}
                                  className="entry-input tnum" style={{ width: 100, fontSize: 12 }} />
                              </div>
                            ))}
                          </td>
                          <td className="tnum" style={{ textAlign: 'right', color: Math.abs(diff) > 1 ? 'var(--negative)' : 'var(--positive)', fontSize: 12 }}>
                            {Math.abs(diff) > 1 ? (diff > 0 ? '+' : '') + formatAmount(diff) : '✓'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--ink-3)', maxWidth: 280 }}>
                            {rule?.note && <div style={{ marginBottom: 4 }}>{rule.note}</div>}
                            {row.entry.tkc_code === '6117' && (() => {
                              const kindOf = (e: AggregatedEntry, i: number) => kind6117[`${month}|${e.store_id}|${i}`]
                              const bdOf = (e: AggregatedEntry) => classifyOutsourcingBreakdown(e, i => kindOf(e, i))
                              const bd = bdOf(row.entry)
                              const KAIGO = 40000
                              // Twinkle代は全6117エントリ(両店舗)を合算して按分
                              const sixEntries = previewRows.map(r => r.entry).filter(e => e.tkc_code === '6117')
                              const totalTwinkle = sixEntries.reduce((s, e) => s + bdOf(e).twinkle, 0)
                              const perStore = Math.max(0, totalTwinkle - KAIGO) / 2
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {row.entry.details.map((d, di) => {
                                    const cur = kindOf(row.entry, di) ?? classifyOutsourcing(d.trader, d.memo, row.entry.store_id, d.amount)
                                    return (
                                      <div key={di} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <span>{d.date.slice(5)} {d.trader || d.memo || '—'} <b className="tnum">{formatAmount(d.amount)}</b></span>
                                        <select value={cur} style={{ fontSize: 10, padding: '0 2px' }}
                                          onChange={e => changeKind6117(row.entry.store_id, di, e.target.value as OutsourcingKind)}>
                                          <option value="twinkle">Twinkle代</option>
                                          <option value="wada">和田委託</option>
                                          <option value="other">その他外注</option>
                                        </select>
                                      </div>
                                    )
                                  })}
                                  <div>当店Twinkle代: <b className="tnum">{formatAmount(bd.twinkle)}</b></div>
                                  {totalTwinkle > 0 && (
                                    <div style={{ paddingLeft: 8, color: 'var(--ink-3)' }}>
                                      全店合算 <b className="tnum">{formatAmount(totalTwinkle)}</b> − {formatAmount(KAIGO)}(介護按分) = <b className="tnum">{formatAmount(totalTwinkle - KAIGO)}</b><br />
                                      ÷ 2店舗 = <b className="tnum">{formatAmount(Math.round(perStore))}</b>/店舗 → twinkle_fee
                                    </div>
                                  )}
                                  <div>和田委託費: <b className="tnum">{formatAmount(bd.wada)}</b> {bd.wada > 0 && <span style={{ color: 'var(--positive)' }}>→ salary_total に加算</span>}</div>
                                  <div>その他真の外注: <b className="tnum">{formatAmount(bd.other)}</b> → outsourcing</div>
                                </div>
                              )
                            })()}
                            {row.entry.tkc_code !== '6117' && row.entry.details.length > 0 && row.entry.details.length <= 6 && (
                              <details>
                                <summary style={{ cursor: 'pointer', fontSize: 10 }}>内訳 {row.entry.details.length}件</summary>
                                <div style={{ paddingTop: 4 }}>
                                  {row.entry.details.map((d, di) => (
                                    <div key={di} style={{ fontSize: 10, lineHeight: 1.3 }}>
                                      {d.date.slice(5)} {d.trader || d.memo || '—'} <span className="tnum">{formatAmount(d.amount)}</span>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="savebar">
          <div className="summary">
            <div className="item">
              <span className="k">取込対象</span>
              <span className="v">{totalSelected}件</span>
            </div>
            <div className="item">
              <span className="k">対象月</span>
              <span className="v">{fiscalYear}年{MONTH_LABELS[month]}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {message && (
              <span style={{ fontSize: 12, color: message.type === 'success' ? 'var(--positive)' : 'var(--negative)' }}>
                {message.text}
              </span>
            )}
            {gateBlocked && (
              <span style={{ fontSize: 12, color: 'var(--negative)' }}>
                要対応 {blockingFindings.length}件を確認してください
              </span>
            )}
            <button className="btn btn-primary" onClick={handleExecute} disabled={executing || totalSelected === 0 || gateBlocked}>
              {executing ? '反映中...' : 'うりぼーに反映'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
