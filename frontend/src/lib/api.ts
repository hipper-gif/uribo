const API_URL = import.meta.env.VITE_API_URL
const API_TOKEN = import.meta.env.VITE_API_TOKEN

function headers(json = false): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${API_TOKEN}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export interface ApiResult<T> { data: T | null; error: { message: string } | null }

export async function apiGet<T = unknown>(table: string, params?: Record<string, string>): Promise<ApiResult<T>> {
  const url = new URL(`${API_URL}/${table}`)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  try {
    const res = await fetch(url.toString(), { headers: headers() })
    if (!res.ok) { const body = await res.json().catch(() => ({})); return { data: null, error: { message: body.error ?? `HTTP ${res.status}` } } }
    return { data: await res.json() as T, error: null }
  } catch (e) { return { data: null, error: { message: (e as Error).message } } }
}

export async function apiPost<T = unknown>(table: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${API_URL}/${table}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body) })
    if (!res.ok) { const data = await res.json().catch(() => ({})); return { data: null, error: { message: data.error ?? `HTTP ${res.status}` } } }
    return { data: await res.json() as T, error: null }
  } catch (e) { return { data: null, error: { message: (e as Error).message } } }
}

export async function apiPatch<T = unknown>(table: string, filters: Record<string, string>, body: Record<string, unknown>): Promise<ApiResult<T>> {
  const url = new URL(`${API_URL}/${table}`)
  for (const [k, v] of Object.entries(filters)) url.searchParams.set(k, v)
  try {
    const res = await fetch(url.toString(), { method: 'PATCH', headers: headers(true), body: JSON.stringify(body) })
    if (!res.ok) { const data = await res.json().catch(() => ({})); return { data: null, error: { message: data.error ?? `HTTP ${res.status}` } } }
    return { data: await res.json() as T, error: null }
  } catch (e) { return { data: null, error: { message: (e as Error).message } } }
}
