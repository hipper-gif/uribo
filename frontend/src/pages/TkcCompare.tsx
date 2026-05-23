import { useState, useMemo, useEffect } from 'react'
import { useItemMaster, useMonthlyData } from '../lib/useBeautyData'
import { FISCAL_MONTHS, currentFiscalYear, formatAmount, formatMan, MGMT_FEE_CODE, NON_TAXABLE_ITEM_CODES } from '../lib/types'

/** TKC勘定科目コード → うりぼー item_code (複数対応) のマッピング */
const TKC_TO_URIBO: Record<string, { name: string; uribo_codes: string[]; note?: string }> = {
  '4111': { name: '売上高', uribo_codes: ['sales'], note: 'うりぼーは税込・割引前。比較時に (sales−discount)÷1.10' },
  '5211': { name: '材料仕入高', uribo_codes: ['cogs'], note: 'うりぼーは税込で保存(÷1.10で税抜換算)' },
  '5200': { name: '当期売上原価', uribo_codes: ['cogs'] },
  '6111': { name: '通勤交通費', uribo_codes: ['transport_total'] },
  '6112': { name: '旅費交通費', uribo_codes: ['travel_expense'] },
  '6113': { name: '広告宣伝費', uribo_codes: ['hpb', 'advertising'] },
  '6116': { name: '採用教育費', uribo_codes: ['training', 'recruitment'] },
  '6117': { name: '外注費', uribo_codes: ['outsourcing'], note: 'Twinkle代は管理費として別計上のため除外' },
  '6118': { name: 'ロイヤルティ', uribo_codes: ['franchise_fee'] },
  '6212': { name: '従業員給与', uribo_codes: ['salary_total'] },
  '6213': { name: '従業員賞与', uribo_codes: ['bonus'] },
  '6214': { name: '減価償却費', uribo_codes: ['depreciation'] },
  '6215': { name: '地代家賃', uribo_codes: ['rent'] },
  '6216': { name: '修繕費', uribo_codes: ['repair'] },
  '6218': { name: '通信費', uribo_codes: ['microsoft', 'spotify', 'amazon_prime', 'communication'] },
  '6219': { name: '水道光熱費', uribo_codes: ['water_utility', 'water_supply', 'electricity', 'gas'] },
  '6223': { name: '接待交際費', uribo_codes: ['entertainment'] },
  '6224': { name: '保険料', uribo_codes: ['insurance'] },
  '6225': { name: '備品消耗品費', uribo_codes: ['supplies'] },
  '6226': { name: '福利厚生費', uribo_codes: ['welfare'] },
  '6227': { name: '支払手数料', uribo_codes: ['fees'] },
  '6228': { name: '会議費', uribo_codes: ['meeting'] },
  '6312': { name: '法定福利費', uribo_codes: ['legal_welfare', 'health_ins_total', 'workers_comp'] },
  '6000': { name: '営業利益', uribo_codes: [], note: '集計行(計算結果)' },
  '6100': { name: '販管費合計', uribo_codes: [], note: '集計行' },
  '5000': { name: '売上総利益', uribo_codes: [], note: '集計行' },
}

type TkcRow = {
  code: string
  name: string
  monthly: Record<number, number>
  total: number
}

function parseTkcCsv(text: string): TkcRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  // ヘッダー: 勘定科目コード,勘定科目名,2025/04,比率,2025/05,比率,...,累計,比率
  const headerCells = lines[0].split(',')
  // 月の位置を取得 (累計の前12列が月)
  const monthCols: Record<number, number> = {}
  let cumIdx = -1
  for (let i = 2; i < headerCells.length; i++) {
    const h = headerCells[i].trim()
    const m = h.match(/^\d{4}\/(\d{2})$/)
    if (m) monthCols[parseInt(m[1], 10)] = i
    if (h === '累計') cumIdx = i
  }
  if (cumIdx === -1) cumIdx = headerCells.length - 2

  const rows: TkcRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim())
    const code = cells[0]
    const name = cells[1]
    if (!code) continue
    const monthly: Record<number, number> = {}
    for (const [m, idx] of Object.entries(monthCols)) {
      const v = cells[idx]
      monthly[parseInt(m, 10)] = v ? parseInt(v.replace(/[^\d\-]/g, ''), 10) || 0 : 0
    }
    const total = cells[cumIdx] ? parseInt(cells[cumIdx].replace(/[^\d\-]/g, ''), 10) || 0 : 0
    rows.push({ code, name, monthly, total })
  }
  return rows
}

export function TkcCompare() {
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear() - 1)
  const [taxMode, setTaxMode] = useState<'inclusive' | 'exclusive'>('exclusive')
  const [tkcRows, setTkcRows] = useState<TkcRow[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [error, setError] = useState<string>('')

  const items = useItemMaster()
  // 全店舗合計(store_id=0 が無いのでフロントで合算)
  const { data: actualData1 } = useMonthlyData(1, fiscalYear, '実績')
  const { data: actualData2 } = useMonthlyData(2, fiscalYear, '実績')

  const uriboLookup = useMemo(() => {
    const m: Record<string, Record<number, number>> = {}
    const all = [...actualData1, ...actualData2]
    for (const d of all) {
      const it = items.find(i => i.id === d.item_id)
      if (!it) continue
      if (!m[it.item_code]) m[it.item_code] = {}
      m[it.item_code][d.month] = (m[it.item_code][d.month] ?? 0) + parseFloat(d.amount)
    }
    return m
  }, [actualData1, actualData2, items])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      // cp932 / Shift-JIS で読む
      const td = new TextDecoder('shift-jis', { fatal: false })
      let text = td.decode(buf)
      // UTF-8 BOM の可能性もあるので試行
      if (!text.includes('売上') && !text.includes('科目')) {
        const td2 = new TextDecoder('utf-8', { fatal: false })
        text = td2.decode(buf)
      }
      const rows = parseTkcCsv(text)
      if (rows.length === 0) {
        setError('CSVから行を読み取れませんでした')
      }
      setTkcRows(rows)
    } catch (e) {
      setError(`CSV読み込みエラー: ${e}`)
    }
  }

  function adjustUriboValue(uriboCode: string, raw: number): number {
    if (taxMode === 'inclusive') return raw
    if (NON_TAXABLE_ITEM_CODES.has(uriboCode)) return raw
    return raw / 1.1
  }

  /** うりぼー側を税抜換算した値で集計 */
  function uriboAdjustedForCodes(codes: string[]): { total: number; monthly: Record<number, number> } {
    const monthly: Record<number, number> = {}
    let total = 0
    for (const code of codes) {
      const m = uriboLookup[code]
      if (!m) continue
      for (const month of FISCAL_MONTHS) {
        const v = adjustUriboValue(code, m[month] ?? 0)
        monthly[month] = (monthly[month] ?? 0) + v
        total += v
      }
    }
    return { total, monthly }
  }

  // 売上は (sales - discount) / 1.10 (税抜時)
  function uriboSalesValue(): { total: number; monthly: Record<number, number> } {
    const salesM = uriboLookup['sales'] ?? {}
    const discM = uriboLookup['discount'] ?? {}
    const monthly: Record<number, number> = {}
    let total = 0
    for (const month of FISCAL_MONTHS) {
      const s = salesM[month] ?? 0
      const d = discM[month] ?? 0
      const v = taxMode === 'exclusive' ? Math.round((s - d) / 1.1) : s
      monthly[month] = v
      total += v
    }
    return { total, monthly }
  }

  // 比較テーブル行データを生成
  const comparisonRows = useMemo(() => {
    return tkcRows.map(tkc => {
      const mapping = TKC_TO_URIBO[tkc.code]
      if (!mapping) {
        return { tkc, mappingFound: false, uriboTotal: 0, diff: 0, note: '未マッピング科目', codes: [] as string[] }
      }
      let uriboTotal = 0
      if (tkc.code === '4111') {
        // 売上は特別扱い
        uriboTotal = uriboSalesValue().total
      } else if (mapping.uribo_codes.length === 0) {
        uriboTotal = 0
      } else {
        uriboTotal = uriboAdjustedForCodes(mapping.uribo_codes).total
      }
      return {
        tkc,
        mappingFound: true,
        uriboTotal: Math.round(uriboTotal),
        diff: Math.round(uriboTotal) - tkc.total,
        note: mapping.note ?? '',
        codes: mapping.uribo_codes,
      }
    })
  }, [tkcRows, uriboLookup, taxMode])

  // サマリー集計
  const tkcSalesTotal = tkcRows.find(r => r.code === '4111')?.total ?? 0
  const tkcExpTotal = tkcRows.find(r => r.code === '6100')?.total ?? 0
  const tkcCogsTotal = tkcRows.find(r => r.code === '5200')?.total ?? 0
  const tkcOpProfit = tkcRows.find(r => r.code === '6000')?.total ?? (tkcSalesTotal - tkcCogsTotal - tkcExpTotal)

  const uriboSales = uriboSalesValue().total
  const uriboCogs = uriboAdjustedForCodes(['cogs']).total
  // 経費合計(売上原価以外、Twinkle代除く)
  const uriboExpense = Object.keys(uriboLookup)
    .filter(c => c !== 'sales' && c !== 'discount' && c !== 'customers' && c !== 'unit_price' && c !== 'cogs' && c !== MGMT_FEE_CODE)
    .reduce((s, c) => {
      const item = items.find(i => i.item_code === c)
      if (!item) return s
      if (item.is_calculated === 1) return s
      const m = uriboLookup[c]
      if (!m) return s
      for (const month of FISCAL_MONTHS) s += adjustUriboValue(c, m[month] ?? 0)
      return s
    }, 0)
  const uriboMgmt = uriboAdjustedForCodes([MGMT_FEE_CODE]).total
  const uriboOpProfit = uriboSales - uriboCogs - uriboExpense - uriboMgmt

  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  // re-render dependency
  useEffect(() => { /* taxMode/fiscalYear updates trigger memo recompute */ }, [taxMode, fiscalYear])

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— ADMIN / TKC</span>
            <h1 className="page-title">TKC比較</h1>
          </div>
          <div className="page-subtitle">管理者専用 · TKC勘定科目残高推移表とうりぼーDBの差額確認</div>
        </div>
        <div className="seg" role="tablist" title="税抜は売上=(税込売上−割引)/1.10、課税経費=÷1.10で表示">
          <button className="seg-btn" aria-pressed={taxMode === 'inclusive'} onClick={() => setTaxMode('inclusive')}>
            <span>税込</span><span className="sub">INCL</span>
          </button>
          <button className="seg-btn" aria-pressed={taxMode === 'exclusive'} onClick={() => setTaxMode('exclusive')}>
            <span>税抜</span><span className="sub">EXCL</span>
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select className="select" value={fiscalYear} onChange={e => setFiscalYear(Number(e.target.value))}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
        <label className="btn btn-primary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 1v10M3 6l5-5 5 5M2 14h12"/>
          </svg>
          TKC CSV を読み込む
          <input type="file" accept=".csv" onChange={handleFileChange} style={{ display: 'none' }} />
        </label>
        {fileName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>📄 {fileName}</span>}
        {error && <span style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</span>}
      </div>

      {tkcRows.length === 0 ? (
        <div style={{ background: 'var(--paper-2)', border: '1px dashed var(--rule)', borderRadius: 10, padding: '40px 24px', textAlign: 'center', color: 'var(--ink-3)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 8 }}>CSV未読み込み</div>
          <div style={{ fontSize: 12 }}>
            TKCで「勘定科目残高推移表」をCSV出力 → 上の「TKC CSV を読み込む」から選択<br />
            (うりぼーDBは一切変更されません)
          </div>
        </div>
      ) : (
        <>
          {/* サマリー */}
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi">
              <div className="kpi-label">売上 · {taxMode === 'exclusive' ? '税抜' : '税込'}</div>
              <div className="kpi-value tnum" style={{ fontSize: 18 }}>¥{formatAmount(uriboSales)}</div>
              <div className="kpi-meta" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                TKC ¥{formatAmount(tkcSalesTotal)} / 差 {uriboSales - tkcSalesTotal >= 0 ? '+' : ''}¥{formatAmount(uriboSales - tkcSalesTotal)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">仕入</div>
              <div className="kpi-value tnum" style={{ fontSize: 18 }}>¥{formatAmount(Math.round(uriboCogs))}</div>
              <div className="kpi-meta" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                TKC ¥{formatAmount(tkcCogsTotal)} / 差 {Math.round(uriboCogs) - tkcCogsTotal >= 0 ? '+' : ''}¥{formatAmount(Math.round(uriboCogs) - tkcCogsTotal)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">経費合計</div>
              <div className="kpi-value tnum" style={{ fontSize: 18 }}>¥{formatAmount(Math.round(uriboExpense + uriboMgmt))}</div>
              <div className="kpi-meta" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                TKC ¥{formatAmount(tkcExpTotal)} / 差 {Math.round(uriboExpense + uriboMgmt) - tkcExpTotal >= 0 ? '+' : ''}¥{formatAmount(Math.round(uriboExpense + uriboMgmt) - tkcExpTotal)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">営業利益</div>
              <div className={`kpi-value tnum ${uriboOpProfit < 0 ? 'num-neg' : 'num-pos'}`} style={{ fontSize: 18 }}>
                {uriboOpProfit < 0 ? '−' : ''}¥{formatAmount(Math.abs(Math.round(uriboOpProfit)))}
              </div>
              <div className="kpi-meta" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                TKC {tkcOpProfit < 0 ? '−' : ''}¥{formatAmount(Math.abs(tkcOpProfit))} / 差 {Math.round(uriboOpProfit) - tkcOpProfit >= 0 ? '+' : ''}¥{formatAmount(Math.round(uriboOpProfit) - tkcOpProfit)}
              </div>
            </div>
          </div>

          {/* 比較テーブル */}
          <div className="card">
            <div className="card-head">
              <div className="card-title"><span className="index">DIFF</span>科目別差額</div>
              <span className="smallcaps">{fiscalYear}年度 · 全店舗合計 · {taxMode === 'exclusive' ? '税抜換算' : '税込'}</span>
            </div>
            <table className="comparison-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--rule)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 10px', width: 60 }}>TKC</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>科目</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px' }}>TKC値</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px' }}>うりぼー</th>
                  <th style={{ textAlign: 'right', padding: '8px 10px' }}>差額</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>備考</th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, i) => {
                  const isSummary = ['5000', '6000', '6100', '7000', '7100', '7200', '4000'].includes(row.tkc.code)
                  const noUribo = row.codes.length === 0 && row.tkc.code !== '4111'
                  const bgColor = isSummary ? 'var(--paper-2)' : undefined
                  const fw = isSummary ? 600 : 400
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--rule-soft)', background: bgColor }}>
                      <td style={{ padding: '6px 10px', color: 'var(--ink-3)', fontFamily: 'monospace', fontWeight: fw }}>{row.tkc.code}</td>
                      <td style={{ padding: '6px 10px', fontWeight: fw }}>{row.tkc.name}</td>
                      <td className="tnum" style={{ padding: '6px 10px', textAlign: 'right', fontWeight: fw }}>{formatMan(row.tkc.total)}</td>
                      <td className="tnum" style={{ padding: '6px 10px', textAlign: 'right', color: noUribo ? 'var(--ink-4)' : undefined }}>
                        {row.codes.length === 0 && row.tkc.code !== '4111' ? '—' : formatMan(row.uriboTotal)}
                      </td>
                      <td className={`tnum ${Math.abs(row.diff) > 100000 ? (row.diff > 0 ? 'num-pos' : 'num-neg') : ''}`}
                          style={{ padding: '6px 10px', textAlign: 'right' }}>
                        {row.codes.length === 0 && row.tkc.code !== '4111' ? '—' : (row.diff >= 0 ? '+' : '') + formatMan(row.diff)}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--ink-3)' }}>{row.note}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--paper-2)', border: '1px solid var(--rule)', borderRadius: 8, fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--ink-2)' }}>注記</strong><br />
            ・売上=4111 はうりぼー側「(税込売上−割引)÷1.10」で税抜換算した値を表示<br />
            ・課税科目はうりぼーの値を÷1.10で表示(税抜モード時)。非課税は給与・賞与・法定福利・通勤交通費・減価償却 等<br />
            ・「うりぼー値」が「—」のTKC科目は うりぼー側に対応itemがない or 入力していない<br />
            ・Twinkle代は経理上はTKC側「6117 外注費」、実際の支払はうりぼー側「Twinkle代」¥130,000/月が正<br />
            ・このページの操作で うりぼーDB は変更されません
          </div>
        </>
      )}
    </div>
  )
}
