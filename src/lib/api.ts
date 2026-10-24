import { useEffect, useState } from 'react'

export interface Session {
  token: string
  name: string
}

const SESSION_KEY = 'f80.session'

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export function setSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // sem armazenamento: a sessão dura só até fechar o app
  }
  window.dispatchEvent(new Event('f80:session'))
}

export function useSession() {
  const [session, set] = useState(getSession)
  useEffect(() => {
    const onChange = () => set(getSession())
    window.addEventListener('f80:session', onChange)
    return () => window.removeEventListener('f80:session', onChange)
  }, [])
  return session
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** fetch autenticado na API; erros viram ApiError (status 0 = sem conexão) */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const session = getSession()
  if (session) headers.set('authorization', `Bearer ${session.token}`)
  if (typeof init.body === 'string') headers.set('content-type', 'application/json')
  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Sem conexão')
  }
  if (res.status === 401 && session) setSession(null)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `Erro ${res.status}`)
  }
  return res
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch(path, init)).json() as Promise<T>
}

export async function login(name: string, code: string) {
  const session = await apiJson<Session>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ name, code }),
  })
  setSession(session)
  return session
}

export async function logout() {
  await apiFetch('/api/logout', { method: 'POST' }).catch(() => {})
  setSession(null)
}

export async function changeBandCode(current: string, next: string) {
  await apiJson('/api/band-code', { method: 'POST', body: JSON.stringify({ current, next }) })
}
