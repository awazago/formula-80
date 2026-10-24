import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { addSongFromFile, db, deleteSong, formatDuration, isVisible, parseDuration, replaceSongPdf, updateSong, type Song } from '../lib/db'
import { forgetPdf } from '../lib/pdf'
import { exportBackup, importBackup } from '../lib/backup'

export function Library() {
  const songs = useLiveQuery(() => db.songs.orderBy('title').filter(isVisible).toArray(), [])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)

  async function upload(files: FileList | File[]) {
    const pdfs = Array.from(files).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
    if (!pdfs.length) return
    const tooBig = pdfs.filter((f) => f.size > 20 * 1024 * 1024)
    for (const [i, f] of pdfs.filter((f) => !tooBig.includes(f)).entries()) {
      setBusy(`Importando ${i + 1}/${pdfs.length}…`)
      await addSongFromFile(f)
    }
    setBusy('')
    if (tooBig.length) alert(`Arquivos acima de 20 MB ignorados:\n${tooBig.map((f) => f.name).join('\n')}`)
  }

  const q = normalize(query)
  const filtered = (songs ?? []).filter(
    (s) => !q || normalize(`${s.title} ${s.artist} ${s.key}`).includes(q),
  )

  return (
    <div
      className="mx-auto max-w-4xl p-4"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        upload(e.dataTransfer.files)
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Músicas <span className="text-base font-normal text-zinc-500">({songs?.length ?? 0})</span></h1>
        <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>+ Adicionar PDFs</button>
        <details className="relative">
          <summary className="btn list-none">⋯</summary>
          <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-1 rounded-lg bg-zinc-800 p-2 shadow-xl">
            <button className="btn justify-start" onClick={() => exportBackup()}>⬇ Exportar backup</button>
            <button className="btn justify-start" onClick={() => backupInput.current?.click()}>⬆ Importar backup</button>
          </div>
        </details>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" multiple hidden
          onChange={(e) => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
        <input ref={backupInput} type="file" accept="application/json,.json" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const r = await importBackup(f)
              alert(`Backup importado: ${r.songs} músicas, ${r.shows} shows.`)
            } catch (err) {
              alert((err as Error).message)
            }
          }} />
      </div>

      {busy && <p className="mb-3 rounded bg-amber-500/20 p-2 text-amber-300">{busy}</p>}
      {dragging && <p className="mb-3 rounded border-2 border-dashed border-amber-500 p-6 text-center">Solte os PDFs aqui</p>}

      <input
        className="input mb-3 w-full"
        placeholder="Buscar por música, artista ou tom…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {songs && songs.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-zinc-700 p-10 text-center text-zinc-400">
          <p className="mb-2 text-lg">Nenhuma música ainda.</p>
          <p className="text-sm">
            Toque em <b>+ Adicionar PDFs</b> (pode selecionar vários). Dica: nomeie os arquivos como
            <br /><code className="text-zinc-300">Artista - Música.pdf</code> que o app preenche os dois campos.
          </p>
        </div>
      )}

      <ul className="divide-y divide-zinc-800">
        {filtered.map((s) => (
          <li key={s.id} className="py-2">
            <div className="flex items-center gap-3">
              <Link to={`/palco/musica/${s.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.title}</div>
                <div className="truncate text-sm text-zinc-400">
                  {[s.artist, s.key && `Tom ${s.key}`, formatDuration(s.durationSec), s.patch && `🎹 ${s.patch}`, s.pdfDirty ? '⬆ enviando PDF' : (s.remoteFileVersion ?? 0) > (s.fileVersion ?? 0) ? '⬇ baixando PDF' : ''].filter(Boolean).join(' · ')}
                </div>
              </Link>
              <button className="btn" onClick={() => setEditing(editing === s.id ? null : s.id)}>Editar</button>
            </div>
            {editing === s.id && <SongForm song={s} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SongForm({ song, onDone }: { song: Song; onDone: () => void }) {
  const [form, setForm] = useState({
    title: song.title,
    artist: song.artist,
    key: song.key,
    bpm: song.bpm ? String(song.bpm) : '',
    duration: formatDuration(song.durationSec),
    patch: song.patch,
    notes: song.notes,
  })
  const replaceInput = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value })

  async function save() {
    await updateSong(song.id, {
      title: form.title.trim() || song.title,
      artist: form.artist.trim(),
      key: form.key.trim(),
      bpm: form.bpm ? Number(form.bpm) || undefined : undefined,
      durationSec: parseDuration(form.duration),
      patch: form.patch.trim(),
      notes: form.notes,
    })
    onDone()
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-zinc-900 p-3 sm:grid-cols-4">
      <label className="field col-span-2">Música<input className="input" value={form.title} onChange={set('title')} /></label>
      <label className="field col-span-2">Artista<input className="input" value={form.artist} onChange={set('artist')} /></label>
      <label className="field">Tom<input className="input" value={form.key} onChange={set('key')} placeholder="Ex.: Am" /></label>
      <label className="field">BPM<input className="input" inputMode="numeric" value={form.bpm} onChange={set('bpm')} /></label>
      <label className="field">Duração<input className="input" value={form.duration} onChange={set('duration')} placeholder="3:45" /></label>
      <label className="field">Timbre/patch<input className="input" value={form.patch} onChange={set('patch')} placeholder="Ex.: A023 Piano" /></label>
      <label className="field col-span-2 sm:col-span-4">Observações<textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></label>
      <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
        <button className="btn btn-primary" onClick={save}>Salvar</button>
        <button className="btn" onClick={onDone}>Cancelar</button>
        <button className="btn" onClick={() => replaceInput.current?.click()}>Trocar PDF</button>
        <button
          className="btn ml-auto text-red-400"
          onClick={async () => {
            if (confirm(`Excluir "${song.title}"? Ela também sai de todos os shows.`)) {
              forgetPdf(song.id)
              await deleteSong(song.id)
            }
          }}
        >
          Excluir
        </button>
        <input ref={replaceInput} type="file" accept="application/pdf,.pdf" hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            forgetPdf(song.id)
            await replaceSongPdf(song.id, f)
          }} />
      </div>
    </div>
  )
}

function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}
