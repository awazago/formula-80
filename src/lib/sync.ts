import { useEffect, useState } from 'react'
import { db, type Show, type Song } from './db'
import { ApiError, apiFetch, apiJson, getSession } from './api'
import { forgetPdf } from './pdf'

// Offline-first: o app sempre lê e grava no IndexedDB do aparelho.
// A sincronização envia o que foi alterado aqui (dirty) e baixa o que mudou na nuvem.
// Conflito: a última gravação vence; registros com alteração local pendente não são sobrescritos.

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error'
  message?: string
  pending: number
  lastSync?: number
}

const LAST_SYNC_KEY = 'f80.lastSync'
// Relê 1 min antes do último sync para não perder gravações simultâneas
const OVERLAP_MS = 60_000

let status: SyncStatus = { state: 'idle', pending: 0 }
const listeners = new Set<(s: SyncStatus) => void>()

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next }
  listeners.forEach((l) => l(status))
}

export function useSyncStatus() {
  const [s, set] = useState(status)
  useEffect(() => {
    listeners.add(set)
    return () => {
      listeners.delete(set)
    }
  }, [])
  return s
}

let running = false
let again = false

export async function syncNow() {
  if (!getSession()) return
  if (running) {
    again = true
    return
  }
  running = true
  setStatus({ state: 'syncing', message: undefined })
  try {
    do {
      again = false
      await push()
      await pull()
    } while (again)
    setStatus({ state: 'idle', message: undefined, lastSync: Date.now() })
  } catch (err) {
    const e = err as ApiError
    if (e.status === 0 || !navigator.onLine) setStatus({ state: 'offline', message: 'Sem conexão' })
    else setStatus({ state: 'error', message: e.message })
  } finally {
    running = false
    await refreshPending()
  }
}

async function refreshPending() {
  const [songs, shows] = await Promise.all([
    db.songs.where('dirty').equals(1).count(),
    db.shows.where('dirty').equals(1).count(),
  ])
  setStatus({ pending: songs + shows })
}

// ---------- Envio ----------

async function push() {
  const songs = await db.songs.where('dirty').equals(1).toArray()
  for (const [i, s] of songs.entries()) {
    setStatus({ message: `Enviando músicas ${i + 1}/${songs.length}` })
    await pushSong(s)
  }
  const shows = await db.shows.where('dirty').equals(1).toArray()
  for (const s of shows) await pushShow(s)
}

async function pushSong(s: Song) {
  await apiJson(`/api/songs/${s.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: s.title, artist: s.artist, key: s.key, bpm: s.bpm, durationSec: s.durationSec,
      patch: s.patch, notes: s.notes, createdAt: s.createdAt, deleted: !!s.deleted,
    }),
  })

  if (s.deleted) {
    // Exclusão confirmada na nuvem: some de vez deste aparelho
    await db.songs.delete(s.id)
    return
  }

  let fileVersion: number | undefined
  if (s.pdfDirty) {
    const file = await db.files.get(s.id)
    if (file) {
      const res = await apiJson<{ fileVersion: number }>(`/api/songs/${s.id}/pdf`, {
        method: 'PUT',
        body: file.blob,
        headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(s.fileName) },
      })
      fileVersion = res.fileVersion
    }
  }

  // Só limpa a pendência se ninguém mexeu na música enquanto ela era enviada
  await db.songs
    .where('id')
    .equals(s.id)
    .modify((cur) => {
      if (fileVersion) {
        cur.fileVersion = fileVersion
        cur.remoteFileVersion = fileVersion
        cur.pdfDirty = 0
      }
      if (cur.updatedAt === s.updatedAt) cur.dirty = 0
    })
}

async function pushShow(s: Show) {
  await apiJson(`/api/shows/${s.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: s.name, date: s.date, venue: s.venue, blocks: s.blocks, createdAt: s.createdAt, deleted: !!s.deleted,
    }),
  })
  if (s.deleted) {
    await db.shows.delete(s.id)
    return
  }
  await db.shows
    .where('id')
    .equals(s.id)
    .modify((cur) => {
      if (cur.updatedAt === s.updatedAt) cur.dirty = 0
    })
}

// ---------- Recebimento ----------

interface RemoteSong extends Omit<Song, 'fileVersion' | 'remoteFileVersion'> {
  fileVersion: number
}

async function pull() {
  const last = Number(localStorage.getItem(LAST_SYNC_KEY) ?? 0) || 0
  const since = Math.max(0, last - OVERLAP_MS)
  const data = await apiJson<{ now: number; songs: RemoteSong[]; shows: Show[] }>(`/api/sync?since=${since}`)

  await db.transaction('rw', db.songs, db.shows, db.files, async () => {
    for (const remote of data.songs) {
      const local = await db.songs.get(remote.id)
      if (local?.dirty) continue
      if (remote.deleted) {
        await db.songs.delete(remote.id)
        await db.files.delete(remote.id)
        continue
      }
      const { fileVersion: remoteFileVersion, ...rest } = remote
      await db.songs.put({
        ...rest,
        fileVersion: local?.fileVersion ?? 0,
        remoteFileVersion,
        dirty: 0,
        pdfDirty: 0,
        deleted: false,
      })
    }
    for (const remote of data.shows) {
      const local = await db.shows.get(remote.id)
      if (local?.dirty) continue
      if (remote.deleted) await db.shows.delete(remote.id)
      else await db.shows.put({ ...remote, dirty: 0, deleted: false })
    }
  })
  localStorage.setItem(LAST_SYNC_KEY, String(data.now))

  await downloadPdfs()
}

/** Baixa todos os PDFs novos ou trocados, para o app funcionar offline no show */
async function downloadPdfs() {
  const missing = (await db.songs.toArray()).filter(
    (s) => !s.deleted && (s.remoteFileVersion ?? 0) > (s.fileVersion ?? 0),
  )
  for (const [i, s] of missing.entries()) {
    setStatus({ message: `Baixando PDFs ${i + 1}/${missing.length}` })
    let blob: Blob
    try {
      blob = await (await apiFetch(`/api/songs/${s.id}/pdf`)).blob()
    } catch (err) {
      // Logo após o envio o PDF pode levar alguns segundos para aparecer: tenta no próximo ciclo
      if ((err as ApiError).status === 404) continue
      throw err
    }
    await db.transaction('rw', db.songs, db.files, async () => {
      await db.files.put({ songId: s.id, blob: new Blob([blob], { type: 'application/pdf' }) })
      await db.songs.update(s.id, { fileVersion: s.remoteFileVersion })
    })
    forgetPdf(s.id)
  }
}

// ---------- Gatilhos ----------

/** Liga a sincronização automática; devolve a função para desligar */
export function startAutoSync() {
  let debounce: number | undefined
  const soon = () => {
    // Mostra a pendência na hora; o envio espera a pessoa parar de digitar
    refreshPending()
    window.clearTimeout(debounce)
    debounce = window.setTimeout(syncNow, 1500)
  }
  const onVisible = () => document.visibilityState === 'visible' && syncNow()
  window.addEventListener('f80:local-change', soon)
  window.addEventListener('online', syncNow)
  document.addEventListener('visibilitychange', onVisible)
  const interval = window.setInterval(() => document.visibilityState === 'visible' && syncNow(), 20_000)
  syncNow()
  return () => {
    window.clearTimeout(debounce)
    window.clearInterval(interval)
    window.removeEventListener('f80:local-change', soon)
    window.removeEventListener('online', syncNow)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** Ao trocar de banda/conta, recomeça a leitura da nuvem do zero */
export function resetSyncCursor() {
  localStorage.removeItem(LAST_SYNC_KEY)
}
