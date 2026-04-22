import { useState, useMemo, useCallback, useEffect } from 'react'
import { useStores, useItemMaster, useMonthlyData, useMonthlyMeta } from '../lib/useBeautyData'
import { apiGet, apiPost, apiPatch } from '../lib/api'
import { FISCAL_MONTHS, MONTH_LABELS, currentFiscalYear, formatPercent, formatMan, formatAmount } from '../lib/types'
import type { BeautyMonthlyData, BeautyMonthlyMeta, DataType } from '../lib/types'
import { fetchBeautyStaff, type MnemeEmployee } from '../lib/mnemeApi'

interface StoreMapEntry { id: number; mneme_employee_id: number; store_id: number }

type CellKey = string
function cellKey(itemId: number, month: number): CellKey { return `${itemId}-${month}` }
type MetaField = 'fulltime' | 'parttime' | 'notes'
function metaKey(field: MetaField, month: number): string { return `meta-${field}-${month}` }
type HelperId = 'sales' | 'labor' | 'fixed' | 'variable' | 'all'

export function TargetSetting() {
  const stores = useStores()
  const items = useItemMaster()
  const [storeId, setStoreId] = useState(1)
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear())
  const [dataType, setDataType] = useState<'目標' | '見通し'>('目標')

  const { data, loading, reload } = useMonthlyData(storeId, fiscalYear, dataType as DataType)
  const { data: metaData, reload: reloadMeta } = useMonthlyMeta(storeId, fiscalYear, dataType as DataType)

  const [editValues, setEditValues] = useState<Record<CellKey, string>>({})
  const [changedCells, setChangedCells] = useState<Set<CellKey>>(new Set())
  const [metaValues, setMetaValues] = useState<Record<string, string>>({})
  const [changedMeta, setChangedMeta] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Helpers state
  const [helperOpen, setHelperOpen] = useState<HelperId | null>(null)
  const [salesAnnual, setSalesAnnual] = useState('')
  const [salesDist, setSalesDist] = useState<'equal' | 'lastyear'>('equal')
  const [transportMonthly, setTransportMonthly] = useState('')
  const [welfareRate, setWelfareRate] = useState('14.5')
  const [prevActuals, setPrevActuals] = useState<BeautyMonthlyData[]>([])
  const [loadingPrev, setLoadingPrev] = useState(false)

  // Labor helper — Mneme staff
  const [mnemeStaff, setMnemeStaff] = useState<MnemeEmployee[]>([])
  const [storeMap, setStoreMap] = useState<StoreMapEntry[]>([])
  const [staffChecked, setStaffChecked] = useState<Set<number>>(new Set())
  const [staffSalary, setStaffSalary] = useState<Record<number, string>>({})
  const [staffHours, setStaffHours] = useState<Record<number, string>>({})
  const [incentiveRate, setIncentiveRate] = useState('4')
  const [loadingStaff, setLoadingStaff] = useState(false)
  const [staffLoaded, setStaffLoaded] = useState(false)

  // Variable ratio helper — per-item ratio overrides
  const [variableRatios, setVariableRatios] = useState<Record<number, string>>({})
  const [ratiosLoaded, setRatiosLoaded] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)

  const dataLookup = useMemo(() => {
    const map: Record<CellKey, BeautyMonthlyData> = {}
    for (const d of data) map[cellKey(d.item_id, d.month)] = d
    return map
  }, [data])

  const metaLookup = useMemo(() => {
    const map: Record<number, BeautyMonthlyMeta> = {}
    for (const m of metaData) map[m.month] = m
    return map
  }, [metaData])

  const initializeFromData = useCallback((records: BeautyMonthlyData[]) => {
    const vals: Record<CellKey, string> = {}
    for (const d of records) {
      const amount = parseFloat(d.amount)
      if (amount !== 0) vals[cellKey(d.item_id, d.month)] = String(amount)
    }
    setEditValues(vals)
    setChangedCells(new Set())
    setSaveMessage(null)
  }, [])

  const initializeFromMeta = useCallback((records: BeautyMonthlyMeta[]) => {
    const vals: Record<string, string> = {}
    for (const m of records) {
      if (m.fulltime_count != null) vals[metaKey('fulltime', m.month)] = String(m.fulltime_count)
      if (m.parttime_count != null) vals[metaKey('parttime', m.month)] = String(m.parttime_count)
      if (m.notes) vals[metaKey('notes', m.month)] = m.notes
    }
    setMetaValues(vals)
    setChangedMeta(new Set())
  }, [])

  useEffect(() => {
    if (data.length > 0) initializeFromData(data)
    else if (!loading) { setEditValues({}); setChangedCells(new Set()) }
  }, [data, loading, initializeFromData])

  useEffect(() => {
    initializeFromMeta(metaData)
  }, [metaData, initializeFromMeta])

  const displayItems = useMemo(() =>
    items.filter(i => !i.is_calculated).sort((a, b) => a.sort_order - b.sort_order), [items])
  const salesItems = useMemo(() => displayItems.filter(i => i.item_category === '売上'), [displayItems])
  const expenseItems = useMemo(() => displayItems.filter(i => i.item_category !== '売上'), [displayItems])
  const salesItem = useMemo(() => items.find(i => i.item_code === 'sales'), [items])
  const unitPriceItem = useMemo(() => items.find(i => i.item_code === 'unit_price'), [items])
  const discountItem = useMemo(() => items.find(i => i.item_code === 'discount'), [items])

  function getCellValue(itemId: number, month: number): number {
    const v = editValues[cellKey(itemId, month)]
    return v !== undefined && v !== '' ? (parseFloat(v) || 0) : 0
  }
  function getRowTotal(itemId: number): number {
    return FISCAL_MONTHS.reduce((s, m) => s + getCellValue(itemId, m), 0)
  }
  function getExpenseTotal(month: number): number {
    return expenseItems.reduce((s, i) => s + getCellValue(i.id, month), 0) + getWithholdingTax(month)
  }
  function getSalesAmount(month: number): number {
    return salesItem ? getCellValue(salesItem.id, month) : 0
  }
  function getUnitPrice(month: number): number {
    return unitPriceItem ? getCellValue(unitPriceItem.id, month) : 0
  }
  function getCustomerCount(month: number): number {
    const sales = getSalesAmount(month)
    const price = getUnitPrice(month)
    return price > 0 ? Math.round(sales / price) : 0
  }
  function getDiscountAmount(month: number): number {
    return discountItem ? getCellValue(discountItem.id, month) : 0
  }
  function getWithholdingTax(month: number): number {
    const net = getSalesAmount(month) - getDiscountAmount(month)
    return net > 0 ? Math.floor(net / 22) : 0  // 簡易課税（みなし仕入率50%）
  }

  function handleCellChange(itemId: number, month: number, value: string) {
    const key = cellKey(itemId, month)
    if (value !== '' && !/^-?\d*\.?\d*$/.test(value)) return
    setEditValues(prev => ({ ...prev, [key]: value }))
    const original = dataLookup[key]
    const originalAmount = original ? String(parseFloat(original.amount)) : ''
    const isChanged = value !== originalAmount && !(value === '' && (originalAmount === '' || originalAmount === '0'))
    setChangedCells(prev => {
      const next = new Set(prev)
      isChanged ? next.add(key) : next.delete(key)
      return next
    })
    setSaveMessage(null)
  }

  // Excelコピペ: ネイティブpasteイベントで処理（React onPasteが発火しないケース対策）
  const handlePasteRef = useCallback((e: ClipboardEvent) => {
    const el = document.activeElement as HTMLInputElement | null
    if (!el || !el.dataset.itemId) return
    const itemId = Number(el.dataset.itemId)
    const month = Number(el.dataset.month)
    const raw = e.clipboardData?.getData('text/plain') ?? ''
    const text = raw.trimEnd()
    if (!text) return

    // 単一値の貼り付け（カンマ除去して反映）
    if (!text.includes('\t') && !text.includes('\n')) {
      const val = text.trim().replace(/,/g, '')
      if (val === '' || /^-?\d*\.?\d*$/.test(val)) {
        e.preventDefault()
        handleCellChange(itemId, month, val)
      }
      return
    }

    // 複数セル（Excel TSV）の貼り付け
    e.preventDefault()

    const allItems = [...salesItems, ...expenseItems]
    const startItemIdx = allItems.findIndex(i => i.id === itemId)
    const startMonthIdx = (FISCAL_MONTHS as readonly number[]).indexOf(month)
    if (startItemIdx < 0 || startMonthIdx < 0) return

    const rows = text.split(/\r?\n/)
    const patches: Record<CellKey, string> = {}

    rows.forEach((row, ri) => {
      row.split('\t').forEach((rawVal, ci) => {
        const itemIdx = startItemIdx + ri
        const monthIdx = startMonthIdx + ci
        if (itemIdx >= allItems.length || monthIdx >= FISCAL_MONTHS.length) return
        const val = rawVal.trim().replace(/,/g, '')
        if (val === '') { patches[cellKey(allItems[itemIdx].id, FISCAL_MONTHS[monthIdx])] = ''; return }
        if (!/^-?\d*\.?\d*$/.test(val)) return
        patches[cellKey(allItems[itemIdx].id, FISCAL_MONTHS[monthIdx])] = val
      })
    })

    if (Object.keys(patches).length > 0) applyToState(patches)
  }, [salesItems, expenseItems])

  useEffect(() => {
    document.addEventListener('paste', handlePasteRef)
    return () => document.removeEventListener('paste', handlePasteRef)
  }, [handlePasteRef])

  function handleMetaChange(field: MetaField, month: number, value: string) {
    if ((field === 'fulltime' || field === 'parttime') && value !== '' && !/^\d*$/.test(value)) return
    const key = metaKey(field, month)
    setMetaValues(prev => ({ ...prev, [key]: value }))
    const original = metaLookup[month]
    let originalVal = ''
    if (original) {
      if (field === 'fulltime') originalVal = original.fulltime_count != null ? String(original.fulltime_count) : ''
      else if (field === 'parttime') originalVal = original.parttime_count != null ? String(original.parttime_count) : ''
      else originalVal = original.notes ?? ''
    }
    const isChanged = value !== originalVal
    setChangedMeta(prev => {
      const next = new Set(prev)
      isChanged ? next.add(key) : next.delete(key)
      return next
    })
    setSaveMessage(null)
  }

  const totalChanges = changedCells.size + changedMeta.size

  function changedMetaMonths(): number[] {
    const months = new Set<number>()
    for (const k of changedMeta) {
      const parts = k.split('-')
      months.add(Number(parts[2]))
    }
    return Array.from(months)
  }

  async function handleSave() {
    if (totalChanges === 0) return
    setSaving(true); setSaveMessage(null)
    let saved = 0, errors = 0
    for (const key of changedCells) {
      const [iid, mm] = key.split('-').map(Number)
      const amount = parseFloat(editValues[key] || '0') || 0
      const existing = dataLookup[key]
      const res = existing
        ? await apiPatch('beauty_monthly_data', { id: `eq.${existing.id}` }, { amount })
        : await apiPost('beauty_monthly_data', { store_id: storeId, fiscal_year: fiscalYear, month: mm, data_type: dataType, item_id: iid, amount })
      res.error ? errors++ : saved++
    }

    for (const mm of changedMetaMonths()) {
      const ft = metaValues[metaKey('fulltime', mm)]
      const pt = metaValues[metaKey('parttime', mm)]
      const nt = metaValues[metaKey('notes', mm)]
      const body: Record<string, unknown> = {
        fulltime_count: ft === '' || ft === undefined ? null : parseInt(ft, 10),
        parttime_count: pt === '' || pt === undefined ? null : parseInt(pt, 10),
        notes: nt === '' || nt === undefined ? null : nt,
      }
      const existing = metaLookup[mm]
      const res = existing
        ? await apiPatch('beauty_monthly_meta', { id: `eq.${existing.id}` }, body)
        : await apiPost('beauty_monthly_meta', { store_id: storeId, fiscal_year: fiscalYear, month: mm, data_type: dataType, ...body })
      res.error ? errors++ : saved++
    }

    setSaving(false)
    setSaveMessage(errors > 0 ? `${saved}件保存、${errors}件エラー` : `${saved}件の${dataType}を保存しました`)
    await Promise.all([reload(), reloadMeta()])
  }

  async function fetchPrevActuals(): Promise<BeautyMonthlyData[]> {
    if (prevActuals.length > 0) return prevActuals
    setLoadingPrev(true)
    const r = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
      select: '*', store_id: `eq.${storeId}`, fiscal_year: `eq.${fiscalYear - 1}`, data_type: 'eq.実績',
    })
    setLoadingPrev(false)
    const d = r.data ?? []
    setPrevActuals(d)
    return d
  }

  // Fetch Mneme staff + store map when labor helper opens
  useEffect(() => {
    if (helperOpen !== 'labor' || staffLoaded) return
    let cancelled = false
    async function load() {
      setLoadingStaff(true)
      const [staff, mapRes] = await Promise.all([
        fetchBeautyStaff(),
        apiGet<StoreMapEntry[]>('beauty_staff_store_map'),
      ])
      if (cancelled) return
      setMnemeStaff(staff)
      const map = mapRes.data ?? []
      setStoreMap(map)
      // Auto-check staff assigned to current store
      const checked = new Set<number>()
      const salaries: Record<number, string> = {}
      for (const s of staff) {
        const mapping = map.find(m => m.mneme_employee_id === s.id)
        if (mapping && mapping.store_id === storeId) checked.add(s.id)
        if (s.base_salary != null) salaries[s.id] = String(s.base_salary)
      }
      setStaffChecked(checked)
      setStaffSalary(prev => ({ ...salaries, ...prev }))
      setLoadingStaff(false)
      setStaffLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [helperOpen, staffLoaded, storeId])

  // Reset staff loaded state when store changes
  useEffect(() => { setStaffLoaded(false) }, [storeId])

  const staffForCurrentStore = useMemo(() => {
    // Show staff assigned to this store + unassigned staff
    return mnemeStaff.filter(s => {
      const mapping = storeMap.find(m => m.mneme_employee_id === s.id)
      return !mapping || mapping.store_id === storeId
    })
  }, [mnemeStaff, storeMap, storeId])

  function getStaffMonthlySalary(emp: MnemeEmployee): number {
    const override = staffSalary[emp.id]
    if (override !== undefined && override !== '') return parseFloat(override) || 0
    return emp.base_salary ?? 0
  }

  function getStaffDisplaySalary(emp: MnemeEmployee): number {
    const base = getStaffMonthlySalary(emp)
    if (emp.salary_type === '時給') {
      const hours = parseFloat(staffHours[emp.id] || '0') || 0
      return base * hours
    }
    return base
  }

  const checkedStaffBaseSalaryTotal = useMemo(() => {
    return staffForCurrentStore
      .filter(s => staffChecked.has(s.id))
      .reduce((sum, s) => sum + getStaffDisplaySalary(s), 0)
  }, [staffForCurrentStore, staffChecked, staffSalary, staffHours])

  async function saveStoreMap() {
    // Save checked staff → current store, remove unchecked
    for (const s of staffForCurrentStore) {
      const existing = storeMap.find(m => m.mneme_employee_id === s.id)
      if (staffChecked.has(s.id)) {
        if (!existing) {
          await apiPost('beauty_staff_store_map', { mneme_employee_id: s.id, store_id: storeId })
        } else if (existing.store_id !== storeId) {
          await apiPatch('beauty_staff_store_map', { id: `eq.${existing.id}` }, { store_id: storeId })
        }
      }
    }
    // Reload map
    const mapRes = await apiGet<StoreMapEntry[]>('beauty_staff_store_map')
    if (mapRes.data) setStoreMap(mapRes.data)
  }

  function applyToState(patches: Record<CellKey, string>) {
    setEditValues(prev => ({ ...prev, ...patches }))
    setChangedCells(prev => { const n = new Set(prev); Object.keys(patches).forEach(k => n.add(k)); return n })
    setSaveMessage(null)
  }

  async function applySalesDistribution() {
    if (!salesItem) return
    const annual = parseFloat(salesAnnual)
    if (!annual) return
    const patches: Record<CellKey, string> = {}
    if (salesDist === 'equal') {
      const monthly = Math.round(annual / 12)
      FISCAL_MONTHS.forEach(m => { patches[cellKey(salesItem.id, m)] = String(monthly) })
    } else {
      const prev = await fetchPrevActuals()
      const prevSales = prev.filter(d => d.item_id === salesItem.id)
      const prevTotal = prevSales.reduce((s, d) => s + parseFloat(d.amount), 0)
      if (prevTotal > 0) {
        FISCAL_MONTHS.forEach(m => {
          const pa = prevSales.find(d => d.month === m)
          patches[cellKey(salesItem.id, m)] = String(Math.round(annual * (pa ? parseFloat(pa.amount) : 0) / prevTotal))
        })
      }
    }
    applyToState(patches)
  }

  async function applyLaborCosts() {
    const baseSalary = checkedStaffBaseSalaryTotal
    const transportVal = parseFloat(transportMonthly) || 0
    const incRate = (parseFloat(incentiveRate) || 0) / 100
    const welRate = (parseFloat(welfareRate) || 0) / 100
    const salaryItem = items.find(i => i.item_code === 'salary_total')
    const transportItem = items.find(i => i.item_code === 'transport_total')
    const welfareItem = items.find(i => i.item_code === 'legal_welfare')
    const patches: Record<CellKey, string> = {}
    FISCAL_MONTHS.forEach(m => {
      const sales = getSalesAmount(m)
      const incentive = Math.round(sales * incRate)
      const salaryTotal = baseSalary + incentive
      if (salaryItem) patches[cellKey(salaryItem.id, m)] = String(salaryTotal)
      if (transportItem) patches[cellKey(transportItem.id, m)] = String(transportVal)
      if (welfareItem) patches[cellKey(welfareItem.id, m)] = String(Math.round(salaryTotal * welRate))
    })
    applyToState(patches)
    // Save store mapping
    await saveStoreMap()
  }

  async function applyFixedCosts() {
    const prev = await fetchPrevActuals()
    const fixedItems = items.filter(i => i.item_category === '固定費')
    const patches: Record<CellKey, string> = {}
    for (const item of fixedItems) {
      for (const m of FISCAL_MONTHS) {
        const pd = prev.find(d => d.item_id === item.id && d.month === m)
        if (pd && parseFloat(pd.amount) !== 0) patches[cellKey(item.id, m)] = String(parseFloat(pd.amount))
      }
    }
    applyToState(patches)
  }

  const variableItems = useMemo(() =>
    items.filter(i => ['仕入', 'その他'].includes(i.item_category) && !i.is_calculated && i.item_code !== 'twinkle_fee'),
    [items])

  async function loadVariableRatios() {
    if (ratiosLoaded) return
    const prev = await fetchPrevActuals()
    if (!salesItem) return
    const ratios: Record<number, string> = {}
    for (const item of variableItems) {
      let totalExp = 0, totalSalesAmt = 0
      for (const m of FISCAL_MONTHS) {
        const prevExp = prev.find(d => d.item_id === item.id && d.month === m)
        const prevSales = prev.find(d => d.item_id === salesItem.id && d.month === m)
        if (prevExp && prevSales) {
          totalExp += parseFloat(prevExp.amount) || 0
          totalSalesAmt += parseFloat(prevSales.amount) || 0
        }
      }
      if (totalSalesAmt > 0) {
        const r = (totalExp / totalSalesAmt) * 100
        ratios[item.id] = r.toFixed(1)
      }
    }
    setVariableRatios(prev => {
      // Only fill in items that don't already have overrides
      const merged = { ...ratios }
      for (const [k, v] of Object.entries(prev)) { if (v !== '') merged[Number(k)] = v }
      return merged
    })
    setRatiosLoaded(true)
  }

  // Load ratios when data is available or variable helper opens
  useEffect(() => {
    if (!ratiosLoaded && data.length > 0) { loadVariableRatios() }
  }, [ratiosLoaded, data])

  function applyVariableRatios() {
    if (!salesItem) return
    const patches: Record<CellKey, string> = {}
    for (const item of variableItems) {
      const rateStr = variableRatios[item.id]
      if (rateStr === undefined || rateStr === '') continue
      const rate = parseFloat(rateStr) / 100
      if (isNaN(rate)) continue
      for (const m of FISCAL_MONTHS) {
        const currSales = getCellValue(salesItem.id, m)
        if (currSales > 0) patches[cellKey(item.id, m)] = String(Math.round(currSales * rate))
      }
    }
    applyToState(patches)
  }

  function handleVariableRateChange(itemId: number, value: string) {
    if (value !== '' && !/^\d*\.?\d*$/.test(value)) return
    setVariableRatios(prev => ({ ...prev, [itemId]: value }))
    if (!salesItem || value === '') return
    const rate = parseFloat(value) / 100
    if (isNaN(rate)) return
    const patches: Record<CellKey, string> = {}
    for (const m of FISCAL_MONTHS) {
      const currSales = getCellValue(salesItem.id, m)
      patches[cellKey(itemId, m)] = currSales > 0 ? String(Math.round(currSales * rate)) : ''
    }
    applyToState(patches)
  }

  async function applyAll() {
    if (!salesItem) return
    const annual = parseFloat(salesAnnual)
    if (!annual) return
    setApplyingAll(true)
    const allPatches: Record<CellKey, string> = {}
    try {
      // 1. 売上月次配分
      const monthSales: Record<number, number> = {}
      if (salesDist === 'equal') {
        const monthly = Math.round(annual / 12)
        FISCAL_MONTHS.forEach(m => { monthSales[m] = monthly })
      } else {
        const prev = await fetchPrevActuals()
        const ps = prev.filter(d => d.item_id === salesItem.id)
        const pt = ps.reduce((s, d) => s + parseFloat(d.amount), 0)
        FISCAL_MONTHS.forEach(m => {
          const pa = ps.find(d => d.month === m)
          monthSales[m] = pt > 0 ? Math.round(annual * (pa ? parseFloat(pa.amount) : 0) / pt) : Math.round(annual / 12)
        })
      }
      FISCAL_MONTHS.forEach(m => { allPatches[cellKey(salesItem.id, m)] = String(monthSales[m]) })

      // 2. Mnemeスタッフ読込
      let localStaff = mnemeStaff
      let localStoreMap = storeMap
      let localChecked = staffChecked
      let localSalaryMap = staffSalary
      if (!staffLoaded) {
        const [staff, mapRes] = await Promise.all([fetchBeautyStaff(), apiGet<StoreMapEntry[]>('beauty_staff_store_map')])
        localStaff = staff
        localStoreMap = mapRes.data ?? []
        const checked = new Set<number>()
        const salaries: Record<number, string> = {}
        for (const s of staff) {
          const mapping = localStoreMap.find(mm => mm.mneme_employee_id === s.id)
          if (mapping && mapping.store_id === storeId) checked.add(s.id)
          if (s.base_salary != null) salaries[s.id] = String(s.base_salary)
        }
        localChecked = checked; localSalaryMap = salaries
        setMnemeStaff(staff); setStoreMap(localStoreMap)
        setStaffChecked(checked); setStaffSalary(prev => ({ ...salaries, ...prev }))
        setStaffLoaded(true)
      }

      // 3. 人件費計算
      const storeStaff = localStaff.filter(s => {
        const mm = localStoreMap.find(x => x.mneme_employee_id === s.id)
        return !mm || mm.store_id === storeId
      })
      const getLocalSalary = (emp: MnemeEmployee) => {
        const ov = localSalaryMap[emp.id]
        const base = ov !== undefined && ov !== '' ? (parseFloat(ov) || 0) : (emp.base_salary ?? 0)
        if (emp.salary_type === '時給') return base * ((parseFloat(staffHours[emp.id] || '0') || 0))
        return base
      }
      const localBaseTotal = storeStaff.filter(s => localChecked.has(s.id)).reduce((sum, s) => sum + getLocalSalary(s), 0)
      const transportVal = parseFloat(transportMonthly) || 0
      const incRate = (parseFloat(incentiveRate) || 0) / 100
      const welRate = (parseFloat(welfareRate) || 0) / 100
      const salaryItemObj = items.find(i => i.item_code === 'salary_total')
      const transportItemObj = items.find(i => i.item_code === 'transport_total')
      const welfareItemObj = items.find(i => i.item_code === 'legal_welfare')
      FISCAL_MONTHS.forEach(m => {
        const incentive = Math.round((monthSales[m] ?? 0) * incRate)
        const salaryTotal = localBaseTotal + incentive
        if (salaryItemObj) allPatches[cellKey(salaryItemObj.id, m)] = String(salaryTotal)
        if (transportItemObj) allPatches[cellKey(transportItemObj.id, m)] = String(transportVal)
        if (welfareItemObj) allPatches[cellKey(welfareItemObj.id, m)] = String(Math.round(salaryTotal * welRate))
      })

      // 4. 固定費（前年実績コピー）
      const prev = await fetchPrevActuals()
      for (const item of items.filter(i => i.item_category === '固定費')) {
        for (const m of FISCAL_MONTHS) {
          const pd = prev.find(d => d.item_id === item.id && d.month === m)
          if (pd && parseFloat(pd.amount) !== 0) allPatches[cellKey(item.id, m)] = String(parseFloat(pd.amount))
        }
      }

      // 5. 変動費（比率適用）
      const prevSalesAll = prev.filter(d => d.item_id === salesItem.id)
      const localRatios: Record<number, string> = { ...variableRatios }
      if (!ratiosLoaded) {
        for (const item of variableItems) {
          if (localRatios[item.id] && localRatios[item.id] !== '') continue
          let totalExp = 0, totalS = 0
          for (const m of FISCAL_MONTHS) {
            const pe = prev.find(d => d.item_id === item.id && d.month === m)
            const ps = prevSalesAll.find(d => d.month === m)
            if (pe && ps) { totalExp += parseFloat(pe.amount) || 0; totalS += parseFloat(ps.amount) || 0 }
          }
          if (totalS > 0) localRatios[item.id] = ((totalExp / totalS) * 100).toFixed(1)
        }
        setVariableRatios(localRatios)
        setRatiosLoaded(true)
      }
      for (const item of variableItems) {
        const rateStr = localRatios[item.id]
        if (!rateStr) continue
        const rate = parseFloat(rateStr) / 100
        if (isNaN(rate)) continue
        for (const m of FISCAL_MONTHS) {
          const s = monthSales[m] ?? 0
          if (s > 0) allPatches[cellKey(item.id, m)] = String(Math.round(s * rate))
        }
      }

      applyToState(allPatches)
      await saveStoreMap()
    } finally {
      setApplyingAll(false)
    }
  }

  const totalSales = FISCAL_MONTHS.reduce((s, m) => s + getSalesAmount(m), 0)
  const totalExp = FISCAL_MONTHS.reduce((s, m) => s + getExpenseTotal(m), 0)
  const totalProfit = totalSales - totalExp
  const years = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)

  const HELPERS: { id: HelperId; label: string; sub: string }[] = [
    { id: 'all', label: '★ まとめて設定', sub: '売上→支出 一括' },
    { id: 'sales', label: '① 売上配分', sub: '年額→月次展開' },
    { id: 'labor', label: '② 人件費', sub: 'Mneme連携' },
    { id: 'fixed', label: '③ 固定費', sub: '前年実績コピー' },
    { id: 'variable', label: '④ 変動費', sub: '比率調整' },
  ]

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <span className="page-index">— 05 / TARGETS</span>
            <h1 className="page-title">目標・見通し設定</h1>
          </div>
          <div className="page-subtitle">{fiscalYear}年度 · {dataType}値を編集</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || totalChanges === 0}>
            {saving ? '保存中...' : `保存${totalChanges > 0 ? ` (${totalChanges})` : ''}`}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <select className="select" value={storeId} onChange={e => { setStoreId(Number(e.target.value)); setChangedCells(new Set()); setChangedMeta(new Set()); setSaveMessage(null); setPrevActuals([]) }}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? ' （閉店）' : ''}</option>)}
        </select>
        <select className="select" value={fiscalYear} onChange={e => { setFiscalYear(Number(e.target.value)); setChangedCells(new Set()); setChangedMeta(new Set()); setSaveMessage(null); setPrevActuals([]) }}>
          {years.map(y => <option key={y} value={y}>{y}年度</option>)}
        </select>
        <div className="seg" role="tablist">
          {(['目標', '見通し'] as const).map(dt => (
            <button key={dt} className="seg-btn" aria-pressed={dataType === dt}
              onClick={() => { setDataType(dt); setChangedCells(new Set()); setChangedMeta(new Set()); setSaveMessage(null) }}>
              <span>{dt}</span>
              <span className="sub">{dt === '目標' ? 'TARGET' : 'FORECAST'}</span>
            </button>
          ))}
        </div>
        {saveMessage && (
          <span style={{ fontSize: 12, color: saveMessage.includes('エラー') ? 'var(--negative)' : 'var(--positive)' }}>
            {saveMessage}
          </span>
        )}
      </div>

      {loading ? <div style={{ color: 'var(--ink-3)', padding: '48px 0', textAlign: 'center' }}>読み込み中...</div> : (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">{dataType}売上</div>
              <div className="kpi-value">{formatMan(totalSales)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalSales / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{dataType}支出</div>
              <div className="kpi-value">{formatMan(totalExp)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>月平均 {formatMan(totalExp / 12)}円</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{dataType}利益</div>
              <div className="kpi-value">{formatMan(totalProfit)}<span className="unit">円</span></div>
              <div className="kpi-meta"><span>{totalSales ? `利益率 ${formatPercent(totalProfit / totalSales)}` : ''}</span></div>
            </div>
            <div className="kpi">
              <div className="kpi-label">編集中</div>
              <div className="kpi-value">{totalChanges}<span className="unit">件</span></div>
              <div className="kpi-meta">
                {totalChanges > 0 && <span className="chip accent">UNSAVED</span>}
                <span>{totalChanges ? '未保存の変更' : '変更なし'}</span>
              </div>
            </div>
          </div>

          {/* STAFF & NOTES — 月別 想定人員と備考（売上目標を設計するベース） */}
          <div className="card" style={{ padding: 0, marginBottom: 12 }}>
            <div className="card-head">
              <div className="card-title"><span className="index">STAFF</span>月別 想定人員 / 備考</div>
              <span className="smallcaps">{dataType} · 正社員/パート人数と予測根拠</span>
            </div>
            <div className="table-scroll">
              <table className="ltable">
                <thead>
                  <tr>
                    <th className="col-label">項目</th>
                    {FISCAL_MONTHS.map(m => <th key={m}>{MONTH_LABELS[m]}</th>)}
                    <th className="tot-col">合計</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="col-label">正社員</td>
                    {FISCAL_MONTHS.map(m => {
                      const k = metaKey('fulltime', m)
                      const isChanged = changedMeta.has(k)
                      return (
                        <td key={m} className={`num ${isChanged ? 'cell-changed' : ''}`} style={{ padding: 0 }}>
                          <input className="cell-input meta-num-input" value={metaValues[k] ?? ''}
                            onChange={e => handleMetaChange('fulltime', m, e.target.value)} placeholder="—" />
                        </td>
                      )
                    })}
                    <td className="num tot-col">
                      {FISCAL_MONTHS.reduce((s, m) => s + (parseInt(metaValues[metaKey('fulltime', m)] || '0', 10) || 0), 0) || '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="col-label">パート</td>
                    {FISCAL_MONTHS.map(m => {
                      const k = metaKey('parttime', m)
                      const isChanged = changedMeta.has(k)
                      return (
                        <td key={m} className={`num ${isChanged ? 'cell-changed' : ''}`} style={{ padding: 0 }}>
                          <input className="cell-input meta-num-input" value={metaValues[k] ?? ''}
                            onChange={e => handleMetaChange('parttime', m, e.target.value)} placeholder="—" />
                        </td>
                      )
                    })}
                    <td className="num tot-col">
                      {FISCAL_MONTHS.reduce((s, m) => s + (parseInt(metaValues[metaKey('parttime', m)] || '0', 10) || 0), 0) || '—'}
                    </td>
                  </tr>
                  <tr className="meta-notes-row">
                    <td className="col-label">備考</td>
                    {FISCAL_MONTHS.map(m => {
                      const k = metaKey('notes', m)
                      const isChanged = changedMeta.has(k)
                      return (
                        <td key={m} className={isChanged ? 'cell-changed' : ''} style={{ padding: 0, verticalAlign: 'top' }}>
                          <textarea className="meta-textarea" value={metaValues[k] ?? ''}
                            onChange={e => handleMetaChange('notes', m, e.target.value)}
                            placeholder="予測根拠…" rows={2} />
                        </td>
                      )
                    })}
                    <td className="tot-col" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Helper panel — collapsed by default */}
          <details className="card helper-details" style={{ marginBottom: 12 }}>
            <summary className="helper-bar" style={{ cursor: 'pointer', listStyle: 'none' }}>
              <span className="caret" style={{ fontSize: 10, marginRight: 6, display: 'inline-block', transition: 'transform 0.15s' }}>▶</span>
              <span className="smallcaps" style={{ color: 'var(--ink-4)', paddingRight: 8 }}>一括入力ヘルパー</span>
              <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>売上配分・人件費計算・固定費コピー・変動費比率</span>
            </summary>
            <div className="helper-bar" style={{ borderTop: '1px solid var(--rule)', paddingTop: 10 }}>
              {HELPERS.map(h => (
                <button key={h.id} className={`helper-btn${helperOpen === h.id ? ' active' : ''}`}
                  onClick={() => setHelperOpen(ho => ho === h.id ? null : h.id)}>
                  <span>{h.label}</span>
                  <span className="helper-btn-sub">{h.sub}</span>
                </button>
              ))}
              {loadingPrev && <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>前年データ読込中…</span>}
            </div>

            {helperOpen === 'all' && (
              <div className="helper-body" style={{ flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  年間売上目標を入力し「全科目に適用」を押すと、売上配分・人件費・固定費・変動費をまとめて計算します。<br />
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>前年実績を参照するため初回は少し時間がかかります。各ヘルパーで個別調整も可能です。</span>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="helper-field">
                    <label className="helper-label">年間売上目標</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" className="helper-input" style={{ width: 160 }} value={salesAnnual}
                        onChange={e => setSalesAnnual(e.target.value)} placeholder="例: 20000000" />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                    </div>
                  </div>
                  <div className="helper-field">
                    <label className="helper-label">配分方法</label>
                    <div className="seg">
                      <button className="seg-btn" aria-pressed={salesDist === 'equal'} onClick={() => setSalesDist('equal')}>均等</button>
                      <button className="seg-btn" aria-pressed={salesDist === 'lastyear'} onClick={() => setSalesDist('lastyear')}>前年比率</button>
                    </div>
                  </div>
                  <div className="helper-field">
                    <label className="helper-label">交通費（月額）</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" className="helper-input" value={transportMonthly}
                        onChange={e => setTransportMonthly(e.target.value)} placeholder="30000" />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                    </div>
                  </div>
                  <div className="helper-field">
                    <label className="helper-label">インセンティブ率</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" className="helper-input" style={{ width: 70 }} value={incentiveRate}
                        onChange={e => setIncentiveRate(e.target.value)} step="0.5" />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>%</span>
                    </div>
                  </div>
                  <div className="helper-field">
                    <label className="helper-label">法定福利率</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="number" className="helper-input" style={{ width: 70 }} value={welfareRate}
                        onChange={e => setWelfareRate(e.target.value)} step="0.1" />
                      <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>%</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-primary" onClick={applyAll} disabled={!salesAnnual || applyingAll}>
                    {applyingAll ? '計算中...' : '全科目に適用'}
                  </button>
                </div>
              </div>
            )}

            {helperOpen === 'sales' && (
              <div className="helper-body">
                <div className="helper-field">
                  <label className="helper-label">年間売上目標</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="number" className="helper-input" value={salesAnnual}
                      onChange={e => setSalesAnnual(e.target.value)} placeholder="例: 20000000" />
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                  </div>
                </div>
                <div className="helper-field">
                  <label className="helper-label">配分方法</label>
                  <div className="seg">
                    <button className="seg-btn" aria-pressed={salesDist === 'equal'} onClick={() => setSalesDist('equal')}>均等配分</button>
                    <button className="seg-btn" aria-pressed={salesDist === 'lastyear'} onClick={() => setSalesDist('lastyear')}>前年実績比率</button>
                  </div>
                </div>
                <div className="helper-field" style={{ justifyContent: 'flex-end' }}>
                  <label className="helper-label">&nbsp;</label>
                  <button className="btn btn-primary" onClick={applySalesDistribution} disabled={!salesAnnual || loadingPrev}>
                    売上に適用
                  </button>
                </div>
              </div>
            )}

            {helperOpen === 'labor' && (
              <div className="helper-body" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                {loadingStaff ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>Mnemeからスタッフ読込中…</div>
                ) : (
                  <>
                    {/* Staff list */}
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span className="helper-label">スタッフ一覧（Mnemeから取得）</span>
                        <button className="btn" style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => { setStaffLoaded(false); setMnemeStaff([]); setStoreMap([]) }}>
                          再読込
                        </button>
                      </div>
                      {staffForCurrentStore.length === 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>
                          美容部門のスタッフがMnemeに未登録です。先にMnemeにスタッフを追加してください。
                        </div>
                      ) : (
                        <table className="staff-table">
                          <thead>
                            <tr>
                              <th style={{ width: 32 }}></th>
                              <th style={{ textAlign: 'left' }}>名前</th>
                              <th style={{ textAlign: 'left' }}>雇用形態</th>
                              <th style={{ textAlign: 'left' }}>給与種別</th>
                              <th style={{ textAlign: 'right' }}>基本給</th>
                              <th style={{ textAlign: 'right' }}>月額</th>
                            </tr>
                          </thead>
                          <tbody>
                            {staffForCurrentStore.map(emp => {
                              const checked = staffChecked.has(emp.id)
                              const isHourly = emp.salary_type === '時給'
                              const monthlySalary = getStaffDisplaySalary(emp)
                              return (
                                <tr key={emp.id} style={{ opacity: checked ? 1 : 0.5 }}>
                                  <td style={{ textAlign: 'center' }}>
                                    <input type="checkbox" checked={checked}
                                      onChange={() => setStaffChecked(prev => {
                                        const next = new Set(prev)
                                        checked ? next.delete(emp.id) : next.add(emp.id)
                                        return next
                                      })} />
                                  </td>
                                  <td>{emp.name}</td>
                                  <td>{emp.employment_type ?? '—'}</td>
                                  <td>{emp.salary_type ?? '月給'}</td>
                                  <td style={{ textAlign: 'right', padding: 0 }}>
                                    <input type="number" className="helper-input staff-salary-input"
                                      value={staffSalary[emp.id] ?? ''}
                                      onChange={e => setStaffSalary(prev => ({ ...prev, [emp.id]: e.target.value }))}
                                      placeholder={emp.base_salary != null ? String(emp.base_salary) : '未設定'} />
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    {isHourly ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>×</span>
                                        <input type="number" className="helper-input staff-hours-input"
                                          value={staffHours[emp.id] ?? ''}
                                          onChange={e => setStaffHours(prev => ({ ...prev, [emp.id]: e.target.value }))}
                                          placeholder="h/月" />
                                        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>=</span>
                                        <span className="tnum">{formatAmount(monthlySalary)}</span>
                                      </div>
                                    ) : (
                                      <span className="tnum">{monthlySalary > 0 ? formatAmount(monthlySalary) : '—'}</span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={5} style={{ textAlign: 'right', fontWeight: 600, fontSize: 12 }}>基本給合計</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                <span className="tnum">{formatAmount(checkedStaffBaseSalaryTotal)}</span>
                                <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 4 }}>円</span>
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      )}
                    </div>

                    {/* Parameters */}
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
                      <div className="helper-field">
                        <label className="helper-label">交通費合計（月額）</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" className="helper-input" value={transportMonthly}
                            onChange={e => setTransportMonthly(e.target.value)} placeholder="例: 30000" />
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>円</span>
                        </div>
                      </div>
                      <div className="helper-field">
                        <label className="helper-label">インセンティブ率（売上×率）</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" className="helper-input" style={{ width: 80 }} value={incentiveRate}
                            onChange={e => setIncentiveRate(e.target.value)} step="0.5" />
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>%</span>
                        </div>
                      </div>
                      <div className="helper-field">
                        <label className="helper-label">法定福利率</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="number" className="helper-input" style={{ width: 80 }} value={welfareRate}
                            onChange={e => setWelfareRate(e.target.value)} step="0.1" />
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>%</span>
                        </div>
                      </div>
                    </div>

                    {/* Monthly estimate summary */}
                    {checkedStaffBaseSalaryTotal > 0 && (
                      <div className="labor-summary">
                        <div className="helper-label" style={{ marginBottom: 6 }}>月額概算</div>
                        <div className="labor-summary-row">
                          <span>基本給</span>
                          <span className="tnum">{formatAmount(checkedStaffBaseSalaryTotal)}円</span>
                        </div>
                        <div className="labor-summary-row">
                          <span>インセンティブ</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>売上×{incentiveRate}%（売上目標により変動）</span>
                        </div>
                        <div className="labor-summary-row">
                          <span>交通費</span>
                          <span className="tnum">{formatAmount(parseFloat(transportMonthly) || 0)}円</span>
                        </div>
                        <div className="labor-summary-row">
                          <span>法定福利</span>
                          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>(基本給+インセンティブ)×{welfareRate}%</span>
                        </div>
                      </div>
                    )}

                    {/* Apply button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary" onClick={applyLaborCosts}
                        disabled={checkedStaffBaseSalaryTotal === 0 && !(parseFloat(transportMonthly) > 0)}>
                        人件費に適用
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {helperOpen === 'fixed' && (
              <div className="helper-body">
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  {fiscalYear - 1}年度の実績から固定費をそのままコピーします。<br />
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>対象: 家賃・商店街費・HPB・加盟費・水道等の固定費科目</span>
                </div>
                <button className="btn btn-primary" onClick={applyFixedCosts} disabled={loadingPrev}>
                  {loadingPrev ? '読込中...' : `${fiscalYear - 1}年度実績からコピー`}
                </button>
              </div>
            )}

            {helperOpen === 'variable' && (
              <div className="helper-body" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
                  各項目の対売上比率(%)を設定し、売上目標に掛けて変動費を計算します。<br />
                  <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>初期値は{fiscalYear - 1}年度実績から算出 ／ ①売上配分を先に適用してから実行してください</span>
                </div>
                {loadingPrev ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '8px 0' }}>前年データ読込中…</div>
                ) : (
                  <>
                    <table className="staff-table" style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>科目</th>
                          <th style={{ textAlign: 'left' }}>カテゴリ</th>
                          <th style={{ textAlign: 'right', width: 100 }}>対売上比率</th>
                          <th style={{ textAlign: 'right' }}>月平均概算</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variableItems.map(item => {
                          const rate = variableRatios[item.id] ?? ''
                          const avgSales = totalSales / 12
                          const estimated = rate !== '' ? Math.round(avgSales * (parseFloat(rate) || 0) / 100) : 0
                          return (
                            <tr key={item.id}>
                              <td>{item.item_name}</td>
                              <td style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{item.item_category}</td>
                              <td style={{ padding: 0, textAlign: 'right' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, padding: '0 8px' }}>
                                  <input type="number" className="helper-input" style={{ width: 72, textAlign: 'right', padding: '3px 6px', fontSize: 12 }}
                                    value={rate} onChange={e => setVariableRatios(prev => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="—" step="0.1" />
                                  <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>%</span>
                                </div>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span className="tnum" style={{ color: estimated > 0 ? 'var(--ink)' : 'var(--ink-4)' }}>
                                  {estimated > 0 ? formatAmount(estimated) : '—'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                      <button className="btn btn-primary" onClick={applyVariableRatios} disabled={totalSales === 0}>
                        変動費に適用
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </details>

          {/* Table */}
          <div className="card" style={{ padding: 0 }}>
            <div className="card-head">
              <div className="card-title"><span className="index">GRID</span>{dataType}入力 · 全科目 × 全月</div>
              <span className="smallcaps">単位: 円 · TABでセル移動</span>
            </div>
            <div className="table-scroll">
              <table className="ltable">
                <thead>
                  <tr>
                    <th className="col-label">科目</th>
                    {FISCAL_MONTHS.map(m => <th key={m}>{MONTH_LABELS[m]}</th>)}
                    <th className="tot-col">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {salesItems.map(item => {
                    const total = getRowTotal(item.id)
                    const isPrimary = item.item_code === 'sales'
                    return (
                      <tr key={item.id} className={isPrimary ? 'emphasis' : ''}>
                        <td className="col-label">{item.item_name}</td>
                        {FISCAL_MONTHS.map(m => {
                          const key = cellKey(item.id, m)
                          const isChanged = changedCells.has(key)
                          return (
                            <td key={m} className={`num ${isChanged ? 'cell-changed' : ''}`} style={{ padding: 0 }}>
                              <input className="cell-input" value={editValues[key] ?? ''}
                                data-item-id={item.id} data-month={m}
                                onFocus={e => e.target.select()}
                                onChange={e => handleCellChange(item.id, m, e.target.value)}
                                placeholder="—" />
                            </td>
                          )
                        })}
                        <td className="num tot-col">{total ? formatMan(total) : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'var(--paper-2)' }}>
                    <td className="col-label" style={{ color: 'var(--ink-3)' }}>客数（自動）</td>
                    {FISCAL_MONTHS.map(m => {
                      const count = getCustomerCount(m)
                      return <td key={m} className="num" style={{ color: 'var(--ink-3)' }}>{count > 0 ? `${count}人` : '—'}</td>
                    })}
                    <td className="num tot-col" style={{ color: 'var(--ink-3)' }}>
                      {FISCAL_MONTHS.reduce((s, m) => s + getCustomerCount(m), 0) || '—'}
                    </td>
                  </tr>
                  {expenseItems.map(item => {
                    const total = getRowTotal(item.id)
                    const isVariable = variableItems.some(v => v.id === item.id)
                    return (
                      <tr key={item.id}>
                        <td className="col-label">
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <span>{item.item_name}</span>
                            {isVariable && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                <input type="text" inputMode="decimal"
                                  style={{ width: 40, textAlign: 'right', padding: '1px 3px', fontSize: 11, border: '1px solid var(--line)', borderRadius: 3, background: 'var(--paper)', fontFamily: 'var(--font-mono)' }}
                                  value={variableRatios[item.id] ?? ''}
                                  onFocus={e => e.target.select()}
                                  onChange={e => handleVariableRateChange(item.id, e.target.value)}
                                  placeholder="—" />
                                <span style={{ fontSize: 10, color: 'var(--ink-4)' }}>%</span>
                              </span>
                            )}
                          </div>
                        </td>
                        {FISCAL_MONTHS.map(m => {
                          const key = cellKey(item.id, m)
                          const isChanged = changedCells.has(key)
                          return (
                            <td key={m} className={`num ${isChanged ? 'cell-changed' : ''}`} style={{ padding: 0 }}>
                              <input className="cell-input" value={editValues[key] ?? ''}
                                data-item-id={item.id} data-month={m}
                                onFocus={e => e.target.select()}
                                onChange={e => handleCellChange(item.id, m, e.target.value)}
                                placeholder="—" />
                            </td>
                          )
                        })}
                        <td className="num tot-col">{total ? formatMan(total) : '—'}</td>
                      </tr>
                    )
                  })}
                  <tr style={{ background: 'var(--paper-2)' }}>
                    <td className="col-label" style={{ color: 'var(--ink-3)' }}>預かり税（自動）</td>
                    {FISCAL_MONTHS.map(m => {
                      const tax = getWithholdingTax(m)
                      return <td key={m} className="num" style={{ color: 'var(--ink-3)' }}>{tax > 0 ? formatMan(tax) : '—'}</td>
                    })}
                    <td className="num tot-col" style={{ color: 'var(--ink-3)' }}>
                      {formatMan(FISCAL_MONTHS.reduce((s, m) => s + getWithholdingTax(m), 0))}
                    </td>
                  </tr>
                  <tr className="total-row">
                    <td className="col-label">支出合計</td>
                    {FISCAL_MONTHS.map(m => <td key={m} className="num">{getExpenseTotal(m) ? formatMan(getExpenseTotal(m)) : '—'}</td>)}
                    <td className="num tot-col">{formatMan(totalExp)}</td>
                  </tr>
                  <tr className={`profit-row${totalProfit < 0 ? ' loss' : ''}`}>
                    <td className="col-label">純利益</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m), e = getExpenseTotal(m)
                      return <td key={m} className="num">{s ? formatMan(s - e) : '—'}</td>
                    })}
                    <td className="num tot-col">{formatMan(totalProfit)}</td>
                  </tr>
                  <tr className="rate-row">
                    <td className="col-label">利益率</td>
                    {FISCAL_MONTHS.map(m => {
                      const s = getSalesAmount(m), e = getExpenseTotal(m)
                      return <td key={m} className="num">{s ? formatPercent((s - e) / s) : '—'}</td>
                    })}
                    <td className="num tot-col">{totalSales ? formatPercent(totalProfit / totalSales) : '—'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Save bar — always visible at bottom */}
          {(totalChanges > 0 || totalSales > 0) && (
            <div className="savebar">
              <div className="summary">
                <div className="item">
                  <span className="k">売上</span>
                  <span className="v">{formatMan(totalSales)}</span>
                </div>
                <div className="item">
                  <span className="k">支出</span>
                  <span className="v">{formatMan(totalExp)}</span>
                </div>
                <div className="item">
                  <span className="k">利益</span>
                  <span className="v" style={{ color: totalProfit >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{formatMan(totalProfit)}</span>
                </div>
                <div className="item">
                  <span className="k">利益率</span>
                  <span className="v" style={{ color: totalProfit >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{totalSales ? formatPercent(totalProfit / totalSales) : '—'}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {totalChanges > 0 && <span className="chip accent">{totalChanges}件未保存</span>}
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || totalChanges === 0}>
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
