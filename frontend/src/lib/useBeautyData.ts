import { useState, useEffect, useCallback } from 'react'
import { apiGet } from './api'
import type { BeautyStore, BeautyItemMaster, BeautyMonthlyData, BeautyMonthlyMeta, DataType } from './types'

export function useStores() {
  const [stores, setStores] = useState<BeautyStore[]>([])
  useEffect(() => {
    apiGet<BeautyStore[]>('beauty_stores', { select: '*', order: 'id' }).then(r => {
      if (r.data) setStores(r.data)
    })
  }, [])
  return stores
}

export function useItemMaster() {
  const [items, setItems] = useState<BeautyItemMaster[]>([])
  useEffect(() => {
    apiGet<BeautyItemMaster[]>('beauty_item_master', { select: '*', order: 'sort_order', is_active: 'eq.1' }).then(r => {
      if (r.data) setItems(r.data)
    })
  }, [])
  return items
}

export function useMonthlyData(storeId: number, fiscalYear: number, dataType?: DataType) {
  const [data, setData] = useState<BeautyMonthlyData[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!fiscalYear) return
    setLoading(true)
    const params: Record<string, string> = {
      select: '*',
      fiscal_year: `eq.${fiscalYear}`,
    }
    if (storeId > 0) params.store_id = `eq.${storeId}`
    if (dataType) params.data_type = `eq.${dataType}`
    const r = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', params)
    if (r.data) setData(r.data)
    setLoading(false)
  }, [storeId, fiscalYear, dataType])

  useEffect(() => { reload() }, [reload])

  return { data, loading, reload }
}

/** 異常検知用: 当年度＋前年度の実績を全店まとめて取得(過去12ヶ月の比較に使う) */
export function useMonthlyHistory(fiscalYear: number) {
  const [history, setHistory] = useState<BeautyMonthlyData[]>([])

  const reload = useCallback(async () => {
    if (!fiscalYear) return
    const fetchYear = (fy: number) =>
      apiGet<BeautyMonthlyData[]>('beauty_monthly_data', {
        select: '*', fiscal_year: `eq.${fy}`, data_type: 'eq.実績',
      })
    const [cur, prev] = await Promise.all([fetchYear(fiscalYear), fetchYear(fiscalYear - 1)])
    setHistory([...(cur.data ?? []), ...(prev.data ?? [])])
  }, [fiscalYear])

  useEffect(() => { reload() }, [reload])
  return { history, reloadHistory: reload }
}

export function useMonthlyMeta(storeId: number, fiscalYear: number, dataType?: DataType) {
  const [data, setData] = useState<BeautyMonthlyMeta[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!fiscalYear) return
    setLoading(true)
    const params: Record<string, string> = {
      select: '*',
      fiscal_year: `eq.${fiscalYear}`,
    }
    if (storeId > 0) params.store_id = `eq.${storeId}`
    if (dataType) params.data_type = `eq.${dataType}`
    const r = await apiGet<BeautyMonthlyMeta[]>('beauty_monthly_meta', params)
    if (r.data) setData(r.data)
    setLoading(false)
  }, [storeId, fiscalYear, dataType])

  useEffect(() => { reload() }, [reload])

  return { data, loading, reload }
}
