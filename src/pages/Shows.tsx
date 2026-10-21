import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, duplicateShow, newShow } from '../lib/db'

export function Shows() {
  const shows = useLiveQuery(() => db.shows.orderBy('date').reverse().toArray(), [])
  const navigate = useNavigate()

  async function create() {
    const show = newShow()
    await db.shows.add(show)
    navigate(`/shows/${show.id}`)
  }

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Shows</h1>
        <button className="btn btn-primary" onClick={create}>+ Novo show</button>
      </div>

      {shows && shows.length === 0 && (
        <p className="rounded-lg border-2 border-dashed border-zinc-700 p-10 text-center text-zinc-400">
          Nenhum show ainda. Crie o primeiro e monte os blocos arrastando as músicas.
        </p>
      )}

      <ul className="divide-y divide-zinc-800">
        {shows?.map((s) => {
          const count = s.blocks.reduce((n, b) => n + b.entries.length, 0)
          return (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Link to={`/shows/${s.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.name}</div>
                <div className="truncate text-sm text-zinc-400">
                  {[formatDate(s.date), s.venue, `${s.blocks.length} blocos`, `${count} músicas`].filter(Boolean).join(' · ')}
                </div>
              </Link>
              <Link to={`/palco/show/${s.id}`} className="btn btn-primary">▶ Tocar</Link>
              <button
                className="btn"
                onClick={async () => {
                  const copy = duplicateShow(s)
                  await db.shows.add(copy)
                  navigate(`/shows/${copy.id}`)
                }}
              >
                Duplicar
              </button>
              <button
                className="btn text-red-400"
                onClick={() => confirm(`Excluir o show "${s.name}"?`) && db.shows.delete(s.id)}
              >
                Excluir
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function formatDate(iso: string) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
