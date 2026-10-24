import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import useEmblaCarousel from 'embla-carousel-react'
import { db, isVisible, type Song } from '../lib/db'
import { PdfView } from '../components/PdfView'
import { usePref } from '../lib/prefs'

interface StageItem {
  songId: string
  blockName: string
  pos: number
  blockSize: number
}

/** Modo palco de um show inteiro: /palco/show/:id?i=3 */
export function ShowStage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const show = useLiveQuery(() => db.shows.get(id!), [id])
  const songs = useLiveQuery(() => db.songs.filter(isVisible).toArray(), [])

  const items = useMemo<StageItem[]>(() => {
    if (!show || !songs) return []
    const exists = new Set(songs.map((s) => s.id))
    return show.blocks.flatMap((b) => {
      const entries = b.entries.filter((e) => exists.has(e.songId))
      return entries.map((e, i) => ({ songId: e.songId, blockName: b.name, pos: i + 1, blockSize: entries.length }))
    })
  }, [show, songs])

  if (show === undefined || songs === undefined) return <Loading />
  if (!show || items.length === 0)
    return <Empty message="Este show ainda não tem músicas." back={`/shows/${id}`} />

  const songMap = new Map(songs.map((s) => [s.id, s]))
  return (
    <Stage
      items={items}
      songMap={songMap}
      startIndex={Math.min(Number(params.get('i') ?? 0), items.length - 1)}
      backTo={`/shows/${id}`}
    />
  )
}

/** Modo palco de uma música avulsa da biblioteca: /palco/musica/:id */
export function SongStage() {
  const { id } = useParams()
  const song = useLiveQuery(() => db.songs.get(id!), [id])
  if (song === undefined) return <Loading />
  if (!song) return <Empty message="Música não encontrada." back="/" />
  return (
    <Stage
      items={[{ songId: song.id, blockName: '', pos: 1, blockSize: 1 }]}
      songMap={new Map([[song.id, song]])}
      startIndex={0}
      backTo="/"
    />
  )
}

function Stage({
  items, songMap, startIndex, backTo,
}: { items: StageItem[]; songMap: Map<string, Song>; startIndex: number; backTo: string }) {
  const navigate = useNavigate()
  const [emblaRef, embla] = useEmblaCarousel({ startIndex, duration: 18 })
  const [index, setIndex] = useState(startIndex)
  const [showControls, setShowControls] = useState(true)
  const [invert, setInvert] = usePref('stage.invert', false)
  const [pageTurn, setPageTurn] = usePref('stage.pedalPageTurn', true)
  const slideRefs = useRef<(HTMLDivElement | null)[]>([])

  useWakeLock()

  useEffect(() => {
    if (!embla) return
    const onSelect = () => {
      const i = embla.selectedScrollSnap()
      setIndex(i)
      slideRefs.current[i]?.scrollTo({ top: 0 })
    }
    embla.on('select', onSelect)

    // Por padrão o Embla só troca com arraste > 50% da tela ou gesto rápido.
    // No palco, um swipe curto (15% da largura) já deve trocar de música.
    const root = embla.rootNode()
    const touch = { active: false, x0: 0, y0: 0, x: 0, y: 0, index: 0 }
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      Object.assign(touch, { active: true, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, index: embla.selectedScrollSnap() })
    }
    const onMove = (e: TouchEvent) => {
      touch.x = e.touches[0].clientX
      touch.y = e.touches[0].clientY
    }
    const onPointerUp = () => {
      if (!touch.active) return
      touch.active = false
      const dx = touch.x - touch.x0
      const dy = touch.y - touch.y0
      if (Math.abs(dx) < root.clientWidth * 0.15 || Math.abs(dx) < Math.abs(dy)) return
      if (embla.selectedScrollSnap() !== touch.index) return
      if (dx < 0) embla.scrollNext()
      else embla.scrollPrev()
    }
    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: true })
    embla.on('pointerUp', onPointerUp)

    return () => {
      embla.off('select', onSelect)
      embla.off('pointerUp', onPointerUp)
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
    }
  }, [embla])

  // Esconde os controles automaticamente para a música ocupar a tela toda
  useEffect(() => {
    if (!showControls) return
    const t = window.setTimeout(() => setShowControls(false), 3500)
    return () => window.clearTimeout(t)
  }, [showControls, index])

  const go = useCallback(
    (dir: 1 | -1) => {
      if (!embla) return
      const el = slideRefs.current[embla.selectedScrollSnap()]
      // Com "virar página" ligado, o pedal rola a música antes de trocar
      if (pageTurn && el) {
        const step = el.clientHeight * 0.85
        if (dir === 1 && el.scrollTop + el.clientHeight < el.scrollHeight - 4) {
          el.scrollBy({ top: step, behavior: 'smooth' })
          return
        }
        if (dir === -1 && el.scrollTop > 4) {
          el.scrollBy({ top: -step, behavior: 'smooth' })
          return
        }
      }
      if (dir === 1) embla.scrollNext()
      else embla.scrollPrev()
    },
    [embla, pageTurn],
  )

  // Pedais Bluetooth funcionam como teclado: setas, PageUp/PageDown ou espaço
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
        e.preventDefault()
        go(1)
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Escape') {
        navigate(backTo)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, navigate, backTo])

  const current = items[index]
  const song = songMap.get(current.songId)
  const next = items[index + 1] && songMap.get(items[index + 1].songId)

  return (
    <div className="fixed inset-0 bg-black text-zinc-100">
      <div
        ref={emblaRef}
        className="h-full overflow-hidden"
        style={{ touchAction: 'pan-y pinch-zoom' }}
        onClick={() => setShowControls((v) => !v)}
      >
        <div className="flex h-full">
          {items.map((item, i) => (
            <div
              key={i}
              ref={(el) => {
                slideRefs.current[i] = el
              }}
              className="h-full min-w-0 flex-[0_0_100%] overflow-x-hidden overflow-y-auto overscroll-contain"
              style={{ touchAction: 'pan-y pinch-zoom' }}
            >
              {/* Só mantém renderizadas a atual, a anterior e a próxima */}
              {Math.abs(i - index) <= 1 ? (
                <PdfView songId={item.songId} version={songMap.get(item.songId)?.fileVersion} invert={invert} />
              ) : (
                <div className="h-full" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Indicador mínimo, sempre visível */}
      {!showControls && (
        <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-xs text-zinc-300">
          {index + 1}/{items.length}
        </div>
      )}

      {showControls && (
        <>
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-zinc-900/95 px-3 py-2 shadow-lg pt-[max(0.5rem,env(safe-area-inset-top))]">
            <Link to={backTo} className="btn">← Sair</Link>
            <div className="min-w-0 flex-1 px-2">
              <div className="truncate font-semibold">
                {song?.title ?? '—'}
                {song?.key && <span className="ml-2 rounded bg-amber-500 px-1.5 text-sm text-black">{song.key}</span>}
              </div>
              <div className="truncate text-xs text-zinc-400">
                {[song?.artist, current.blockName && `${current.blockName} · ${current.pos}/${current.blockSize}`, song?.patch && `🎹 ${song.patch}`]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <button className="btn" onClick={() => setInvert(!invert)} title="Inverter cores">
              {invert ? '☀︎' : '☾'}
            </button>
            <button className="btn" onClick={() => setPageTurn(!pageTurn)} title="Comportamento do pedal">
              Pedal: {pageTurn ? 'rola página' : 'troca música'}
            </button>
            <button className="btn" onClick={toggleFullscreen} title="Tela cheia">⛶</button>
          </div>

          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-zinc-900/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button className="btn" disabled={index === 0} onClick={() => embla?.scrollPrev()}>‹ Anterior</button>
            <div className="flex-1 truncate text-center text-sm text-zinc-400">
              {index + 1}/{items.length}
              {next && <> · Próxima: <span className="text-zinc-200">{next.title}</span></>}
            </div>
            <button className="btn" disabled={index === items.length - 1} onClick={() => embla?.scrollNext()}>Próxima ›</button>
          </div>
        </>
      )}
    </div>
  )
}

function toggleFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  if (document.fullscreenElement || doc.webkitFullscreenElement) {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {})
    else doc.webkitExitFullscreen?.()
  } else if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {})
  } else {
    el.webkitRequestFullscreen?.()
  }
}

/** Mantém a tela do tablet ligada durante o show */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const request = () => {
      if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {})
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      document.removeEventListener('visibilitychange', request)
      lock?.release().catch(() => {})
    }
  }, [])
}

function Loading() {
  return <div className="p-8 text-center text-zinc-500">Carregando…</div>
}

function Empty({ message, back }: { message: string; back: string }) {
  return (
    <div className="p-8 text-center">
      <p className="mb-4 text-zinc-400">{message}</p>
      <Link to={back} className="btn">← Voltar</Link>
    </div>
  )
}
