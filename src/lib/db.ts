import Dexie, { type EntityTable } from 'dexie'

/** Campos de controle da sincronização com a nuvem */
interface SyncFields {
  /** 1 = alterado neste aparelho e ainda não enviado */
  dirty?: 0 | 1
  /** Excluído aqui, aguardando envio da exclusão */
  deleted?: boolean
  updatedBy?: string
}

export interface Song extends SyncFields {
  id: string
  title: string
  artist: string
  key: string
  bpm?: number
  durationSec?: number
  /** Timbre / patch do teclado */
  patch: string
  notes: string
  fileName: string
  /** Versão do PDF salva neste aparelho */
  fileVersion?: number
  /** Versão do PDF disponível na nuvem */
  remoteFileVersion?: number
  /** 1 = PDF novo/trocado aqui, ainda não enviado */
  pdfDirty?: 0 | 1
  createdAt: number
  updatedAt: number
}

export interface SongFile {
  songId: string
  blob: Blob
}

export interface SetEntry {
  uid: string
  songId: string
}

export interface Block {
  id: string
  name: string
  entries: SetEntry[]
}

export interface Show extends SyncFields {
  id: string
  name: string
  date: string
  venue: string
  blocks: Block[]
  createdAt: number
  updatedAt: number
}

export const db = new Dexie('formula80-setlist') as Dexie & {
  songs: EntityTable<Song, 'id'>
  files: EntityTable<SongFile, 'songId'>
  shows: EntityTable<Show, 'id'>
}

db.version(1).stores({
  songs: 'id, title, artist',
  files: 'songId',
  shows: 'id, date',
})

// v2: sincronização. Tudo que já existia no aparelho é enviado para a nuvem.
db.version(2)
  .stores({
    songs: 'id, title, artist, dirty',
    files: 'songId',
    shows: 'id, date, dirty',
  })
  .upgrade(async (tx) => {
    await tx.table('songs').toCollection().modify((s: Song) => {
      s.dirty = 1
      s.pdfDirty = 1
    })
    await tx.table('shows').toCollection().modify((s: Show) => {
      s.dirty = 1
    })
  })

/** Avisa o motor de sincronização que há alteração local para enviar */
export function notifyLocalChange() {
  window.dispatchEvent(new Event('f80:local-change'))
}

export const isVisible = <T extends { deleted?: boolean }>(r: T) => !r.deleted

// crypto.randomUUID só existe em contexto seguro (https/localhost).
export function uid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export async function addSongFromFile(file: File): Promise<string> {
  const { title, artist } = parseFileName(file.name)
  const now = Date.now()
  const id = uid()
  await db.transaction('rw', db.songs, db.files, async () => {
    await db.songs.add({
      id, title, artist, key: '', patch: '', notes: '',
      fileName: file.name, createdAt: now, updatedAt: now, dirty: 1, pdfDirty: 1,
    })
    await db.files.add({ songId: id, blob: file })
  })
  notifyLocalChange()
  return id
}

export async function updateSong(id: string, changes: Partial<Song>) {
  await db.songs.update(id, { ...changes, updatedAt: Date.now(), dirty: 1 })
  notifyLocalChange()
}

export async function replaceSongPdf(id: string, file: File) {
  await db.transaction('rw', db.songs, db.files, async () => {
    await db.files.put({ songId: id, blob: file })
    await db.songs.update(id, { fileName: file.name, updatedAt: Date.now(), dirty: 1, pdfDirty: 1 })
  })
  notifyLocalChange()
}

export async function deleteSong(id: string) {
  const now = Date.now()
  await db.transaction('rw', db.songs, db.files, db.shows, async () => {
    await db.songs.update(id, { deleted: true, dirty: 1, updatedAt: now })
    await db.files.delete(id)
    // Remove a música de todos os shows
    await db.shows.toCollection().modify((show) => {
      if (!show.blocks.some((b) => b.entries.some((e) => e.songId === id))) return
      show.blocks = show.blocks.map((b) => ({
        ...b,
        entries: b.entries.filter((e) => e.songId !== id),
      }))
      show.updatedAt = now
      show.dirty = 1
    })
  })
  notifyLocalChange()
}

export async function saveShow(show: Show) {
  await db.shows.put({ ...show, dirty: 1 })
  notifyLocalChange()
}

export async function deleteShow(id: string) {
  await db.shows.update(id, { deleted: true, dirty: 1, updatedAt: Date.now() })
  notifyLocalChange()
}

export function newShow(): Show {
  const now = Date.now()
  return {
    id: uid(),
    name: 'Novo show',
    date: new Date().toISOString().slice(0, 10),
    venue: '',
    blocks: [
      { id: uid(), name: 'Bloco 1', entries: [] },
      { id: uid(), name: 'Bloco 2', entries: [] },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

export function duplicateShow(show: Show): Show {
  const now = Date.now()
  return {
    ...show,
    updatedBy: undefined,
    id: uid(),
    name: `${show.name} (cópia)`,
    blocks: show.blocks.map((b) => ({
      id: uid(),
      name: b.name,
      entries: b.entries.map((e) => ({ uid: uid(), songId: e.songId })),
    })),
    createdAt: now,
    updatedAt: now,
  }
}

/** "01 - Legião Urbana - Tempo Perdido.pdf" → { artist: "Legião Urbana", title: "Tempo Perdido" } */
export function parseFileName(name: string): { title: string; artist: string } {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d+\s*[-.)]\s*/, '')
    .trim()
  const parts = base.split(/\s+-\s+/)
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() }
  }
  return { title: base, artist: '' }
}

export function parseDuration(text: string): number | undefined {
  const t = text.trim()
  if (!t) return undefined
  const m = t.match(/^(\d+):(\d{1,2})$/)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? Math.round(n * 60) : undefined
}

export function formatDuration(sec?: number): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTotal(sec: number): string {
  if (!sec) return '—'
  const total = Math.round(sec / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
}
