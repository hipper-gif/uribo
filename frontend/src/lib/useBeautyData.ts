import { useState, useEffect, useCallback } from 'react'
import { apiGet } from './api'
import type { BeautyStore, BeautyItemMaster, BeautyMonthlyData, DataType } from './types'

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
    if (!storeId || !fiscalYear) return
    setLoading(true)
    const params: Record<string, string> = {
      select: '*',
      store_id: `eq.${storeId}`,
      fiscal_year: `eq.${fiscalYear}`,
    }
    if (dataType) params.data_type = `eq.${dataType}`
    const r = await apiGet<BeautyMonthlyData[]>('beauty_monthly_data', params)
    if (r.data) setData(r.data)
    setLoading(false)
  }, [storeId, fiscalYear, dataType])

  useEffect(() => { reload() }, [reload])

  return { data, loading, reload }
}
