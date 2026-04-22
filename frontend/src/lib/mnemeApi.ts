const MNEME_URL = import.meta.env.VITE_MNEME_API_URL
const MNEME_TOKEN = import.meta.env.VITE_MNEME_API_TOKEN

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
  const url = `${MNEME_URL}/employees?${params}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${MNEME_TOKEN}` },
    })
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}
