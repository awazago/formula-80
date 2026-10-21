import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { loadPdf } from '../lib/pdf'

function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let timer: number | undefined
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width)
      // Debounce: evita re-renderizar o PDF várias vezes ao girar o tablet
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setWidth(w), 120)
    })
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => {
      ro.disconnect()
      window.clearTimeout(timer)
    }
  }, [ref])
  return width
}

export function PdfView({ songId, invert = false }: { songId: string; invert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setDoc(null)
    setError('')
    loadPdf(songId)
      .then((d) => alive && setDoc(d))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [songId])

  return (
    <div ref={ref} className="w-full">
      {error && <p className="p-8 text-center text-red-400">{error}</p>}
      {!doc && !error && <p className="p-8 text-center text-zinc-500">Carregando…</p>}
      {doc &&
        width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PdfPage key={i} doc={doc} pageNumber={i + 1} width={width} invert={invert} />
        ))}
    </div>
  )
}

function PdfPage({
  doc, pageNumber, width, invert,
}: { doc: PDFDocumentProxy; pageNumber: number; width: number; invert: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null
    doc.getPage(pageNumber).then((page) => {
      const canvas = canvasRef.current
      if (cancelled || !canvas) return
      const scale = width / page.getViewport({ scale: 1 }).width
      // Limita a densidade a 2x para economizar memória em tablets
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * dpr })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${width}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      task = page.render({ canvas, viewport })
      task.promise.catch(() => {})
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, width])

  return (
    <canvas
      ref={canvasRef}
      className="mx-auto mb-2 block max-w-full bg-white"
      style={invert ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined}
    />
  )
}
