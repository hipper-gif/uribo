// Mneme（従業員DB）参照 — mneme-api を直接叩かず、nicolio-api のプロキシ
// （/api.php/mneme/employees、セッション認証）を経由する。
// admin/sysadmin セッションでは全カラム取得可（うりぼー利用者は admin 前提）。

const API_URL = import.meta.env.VITE_API_URL

export interface MnemeEmployee {
  id: number
  name: string
  employment_type: string | null
  base_salary: number | null
  salary_type: string | null
  job_title: string | null
  primary_department: string
  departments: string[]
  health_insurance_enrolled: number
  pension_enrolled: number
  health_insurance_premium: number | null
  care_insurance_premium: number | null
  pension_insurance_premium: number | null
}

export async function fetchBeautyStaff(): Promise<MnemeEmployee[]> {
  const params = new URLSearchParams({
    or: '(primary_department.eq.美容,departments.cs.{美容})',
    is_active: 'eq.1',
    select: 'id,name,employment_type,base_salary,salary_type,job_title,primary_department,departments,health_insurance_enrolled,pension_enrolled,health_insurance_premium,care_insurance_premium,pension_insurance_premium',
  })
  const url = `${API_URL}/mneme/employees?${params}`
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

// ===== 等級表（Mneme salary_grades・美容=department_id 3） =====
// nicolio-api プロキシ経由（admin セッションの GET のみ許可）
export interface SalaryGrade {
  id: number
  department_id: number
  employment_type: string   // 'パート・アルバイト' | '有期雇用' | '正社員'
  salary_type: string       // '時給' | '月給'
  grade: 'A' | 'B' | 'C' | 'D'
  base_salary: number
  conditions: string | null
  effective_from: string
  effective_to: string | null
  sort_order: number
}

export async function fetchSalaryGrades(): Promise<SalaryGrade[]> {
  const params = new URLSearchParams({
    department_id: 'eq.3',
    order: 'effective_from.desc,employment_type,sort_order',
  })
  try {
    const res = await fetch(`${API_URL}/mneme/salary_grades?${params}`, { credentials: 'include' })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}
