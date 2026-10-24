import { useState } from 'react'
import { changeBandCode, logout, type Session } from '../lib/api'
import { syncNow, useSyncStatus } from '../lib/sync'

export function SyncBadge() {
  const s = useSyncStatus()
  const label =
    s.state === 'syncing' ? `⟳ ${s.message ?? 'Sincronizando…'}`
    : s.state === 'offline' ? `⚠ Offline${s.pending ? ` · ${s.pending} pendente${s.pending > 1 ? 's' : ''}` : ''}`
    : s.state === 'error' ? `⚠ ${s.message ?? 'Erro ao sincronizar'}`
    : s.pending ? `⟳ ${s.pending} pendente${s.pending > 1 ? 's' : ''}`
    : '✓ Sincronizado'
  const color =
    s.state === 'error' ? 'text-red-400' : s.state === 'offline' ? 'text-amber-400' : 'text-zinc-400'
  return (
    <button className={`max-w-56 truncate text-xs ${color} hover:text-white`} onClick={() => syncNow()} title="Sincronizar agora">
      {label}
    </button>
  )
}

export function AccountMenu({ session }: { session: Session }) {
  const [changing, setChanging] = useState(false)
  return (
    <details className="relative">
      <summary className="btn list-none">👤 {session.name}</summary>
      <div className="absolute right-0 z-30 mt-1 w-72 space-y-2 rounded-lg bg-zinc-800 p-3 shadow-xl">
        {changing ? (
          <ChangeCodeForm onDone={() => setChanging(false)} />
        ) : (
          <>
            <button className="btn w-full justify-start" onClick={() => setChanging(true)}>🔑 Alterar código da banda</button>
            <button className="btn w-full justify-start" onClick={() => logout()}>↩ Sair</button>
          </>
        )}
      </div>
    </details>
  )
}

function ChangeCodeForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState('')
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await changeBandCode(current, next)
          alert('Código alterado. Os outros integrantes vão precisar entrar de novo com o código novo.')
          onDone()
        } catch (err) {
          setMsg((err as Error).message)
        }
      }}
    >
      <label className="field">Código atual<input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
      <label className="field">Novo código (mín. 6)<input className="input" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} required /></label>
      {msg && <p className="text-xs text-red-300">{msg}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1">Salvar</button>
        <button type="button" className="btn" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  )
}
