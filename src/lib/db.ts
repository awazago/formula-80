import Dexie, { type EntityTable } from 'dexie'

export interface Song {
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

export interface Show {
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
      fileName: file.name, createdAt: now, updatedAt: now,
    })
    await db.files.add({ songId: id, blob: file })
  })
  return id
}

export async function deleteSong(id: string) {
  await db.transaction('rw', db.songs, db.files, db.shows, async () => {
    await db.songs.delete(id)
    await db.files.delete(id)
    // Remove a música de todos os shows
    await db.shows.toCollection().modify((show) => {
      show.blocks = show.blocks.map((b) => ({
        ...b,
        entries: b.entries.filter((e) => e.songId !== id),
      }))
    })
  })
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
