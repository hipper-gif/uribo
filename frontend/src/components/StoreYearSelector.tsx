import type { BeautyStore, DataType } from '../lib/types'
import { currentFiscalYear } from '../lib/types'

interface Props {
  stores: BeautyStore[]
  storeId: number
  fiscalYear: number
  dataType?: DataType
  onStoreChange: (id: number) => void
  onYearChange: (y: number) => void
  onDataTypeChange?: (dt: DataType) => void
  showDataType?: boolean
  showInactive?: boolean
}

const YEARS = Array.from({ length: 6 }, (_, i) => currentFiscalYear() - i)
const DATA_TYPES: DataType[] = ['実績', '目標', '見通し']

export function StoreYearSelector({ stores, storeId, fiscalYear, dataType, onStoreChange, onYearChange, onDataTypeChange, showDataType, showInactive }: Props) {
  const filtered = showInactive ? stores : stores.filter(s => s.is_active)
  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <select value={storeId} onChange={e => onStoreChange(Number(e.target.value))}
        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white">
        {filtered.map(s => <option key={s.id} value={s.id}>{s.name}{!s.is_active ? '（閉店）' : ''}</option>)}
      </select>
      <select value={fiscalYear} onChange={e => onYearChange(Number(e.target.value))}
        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white">
        {YEARS.map(y => <option key={y} value={y}>{y}年度</option>)}
      </select>
      {showDataType && onDataTypeChange && (
        <div className="flex gap-1">
          {DATA_TYPES.map(dt => (
            <button key={dt} onClick={() => onDataTypeChange(dt)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                dataType === dt ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}>{dt}</button>
          ))}
        </div>
      )}
    </div>
  )
}
