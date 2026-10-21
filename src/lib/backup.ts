import { db, type Show, type Song } from './db'

// Até o MVP 2 (sincronização na nuvem), o backup é o jeito de levar
// as músicas e shows de um aparelho para outro.

interface BackupFile {
  app: 'formula80-setlist'
  version: 1
  exportedAt: string
  songs: Song[]
  shows: Show[]
  files: { songId: string; type: string; base64: string }[]
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export async function exportBackup() {
  const [songs, shows, files] = await Promise.all([db.songs.toArray(), db.shows.toArray(), db.files.toArray()])
  const data: BackupFile = {
    app: 'formula80-setlist',
    version: 1,
    exportedAt: new Date().toISOString(),
    songs,
    shows,
    files: await Promise.all(
      files.map(async (f) => ({ songId: f.songId, type: f.blob.type || 'application/pdf', base64: await blobToBase64(f.blob) })),
    ),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `formula80-backup-${data.exportedAt.slice(0, 10)}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Mescla o backup com o que já existe (mesmo id = substitui) */
export async function importBackup(file: File): Promise<{ songs: number; shows: number }> {
  const data = JSON.parse(await file.text()) as BackupFile
  if (data.app !== 'formula80-setlist') throw new Error('Arquivo não é um backup do Fórmula 80 Setlist')
  await db.transaction('rw', db.songs, db.shows, db.files, async () => {
    await db.songs.bulkPut(data.songs)
    await db.shows.bulkPut(data.shows)
    await db.files.bulkPut(data.files.map((f) => ({ songId: f.songId, blob: base64ToBlob(f.base64, f.type) })))
  })
  return { songs: data.songs.length, shows: data.shows.length }
}
