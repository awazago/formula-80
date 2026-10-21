// Build "legacy": inclui polyfills para Safari/Chrome de tablets mais antigos
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { db } from './db'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

interface Entry {
  doc: Promise<PDFDocumentProxy>
  task?: PDFDocumentLoadingTask
}

// Mantém poucos documentos abertos para não estourar a memória do tablet.
const MAX_OPEN = 6
const cache = new Map<string, Entry>()

export function loadPdf(songId: string): Promise<PDFDocumentProxy> {
  const hit = cache.get(songId)
  if (hit) {
    cache.delete(songId)
    cache.set(songId, hit)
    return hit.doc
  }
  const entry: Entry = { doc: Promise.resolve(null as never) }
  entry.doc = (async () => {
    const file = await db.files.get(songId)
    if (!file) throw new Error('PDF não encontrado neste dispositivo')
    const data = new Uint8Array(await file.blob.arrayBuffer())
    entry.task = pdfjs.getDocument({ data })
    return entry.task.promise
  })()
  entry.doc.catch(() => cache.delete(songId))
  cache.set(songId, entry)

  while (cache.size > MAX_OPEN) {
    const oldId = cache.keys().next().value!
    forgetPdf(oldId)
  }
  return entry.doc
}

export function forgetPdf(songId: string) {
  const hit = cache.get(songId)
  cache.delete(songId)
  hit?.doc.then(() => hit.task?.destroy()).catch(() => {})
}
