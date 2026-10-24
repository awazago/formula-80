import { useState } from 'react'
import { ApiError, login } from '../lib/api'

export function Login() {
  const [name, setName] = useState(() => localStorage.getItem('f80.lastName') ?? '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(name, code)
      localStorage.setItem('f80.lastName', name.trim())
    } catch (err) {
      const e = err as ApiError
      setError(e.status === 0 ? 'Sem conexão. Conecte-se à internet para entrar.' : e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-zinc-900 p-6 shadow-2xl">
        <div className="text-center">
          <img src="/icon-192.png" alt="" className="mx-auto mb-3 h-20 w-20 rounded-2xl" />
          <h1 className="text-2xl font-bold">
            Fórmula <span className="text-amber-500">80</span>
          </h1>
          <p className="text-sm text-zinc-400">Cifras e setlists da banda</p>
        </div>
        <label className="field">
          Seu nome
          <input className="input text-base" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </label>
        <label className="field">
          Código da banda
          <input className="input text-base" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="rounded bg-red-500/15 p-2 text-sm text-red-300">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  )
}
