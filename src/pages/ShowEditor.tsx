import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCorners,
  useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, formatDuration, formatTotal, isVisible, saveShow, uid, type Block, type SetEntry, type Show, type Song } from '../lib/db'

const LIB_PREFIX = 'lib:'

export function ShowEditor() {
  const { id } = useParams()
  const stored = useLiveQuery(() => db.shows.get(id!), [id])
  const songs = useLiveQuery(() => db.songs.orderBy('title').filter(isVisible).toArray(), [])
  const [show, setShow] = useState<Show | null>(null)
  const dragging = useRef(false)
  const lastEditAt = useRef(0)

  // O estado local é a fonte durante a edição. Só recarrega do banco ao abrir
  // ou quando chega uma versão de outro integrante: nunca com alteração local
  // pendente, durante um arraste ou logo após uma edição feita aqui.
  useEffect(() => {
    if (!stored || stored.deleted) return
    setShow((cur) => {
      if (!cur || cur.id !== stored.id) return stored
      if (stored.dirty || dragging.current || Date.now() - lastEditAt.current < 3000) return cur
      return stored.updatedAt !== cur.updatedAt ? stored : cur
    })
  }, [stored])

  if (stored === null || stored?.deleted) return <p className="p-8 text-center text-zinc-400">Show não encontrado. <Link to="/shows" className="underline">Voltar</Link></p>
  if (!show || !songs) return <p className="p-8 text-center text-zinc-500">Carregando…</p>
  const edit = (next: Show) => {
    lastEditAt.current = Date.now()
    setShow(next)
  }
  return <Editor show={show} setShow={edit} songs={songs} dragging={dragging} />
}

function Editor({
  show, setShow, songs, dragging,
}: { show: Show; setShow: (s: Show) => void; songs: Song[]; dragging: React.RefObject<boolean> }) {
  const songMap = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs])
  const [activeBlockId, setActiveBlockId] = useState(show.blocks[0]?.id ?? '')
  const [dragId, setDragId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const snapshot = useRef<Block[] | null>(null)
  const blocks = show.blocks

  function save(next: Partial<Show>) {
    const updated = { ...show, ...next, updatedAt: Date.now() }
    setShow(updated)
    saveShow(updated)
  }
  const setBlocks = (b: Block[], persist = true) => (persist ? save({ blocks: b }) : setShow({ ...show, blocks: b }))

  // Handle de arraste: no toque, segurar ~150 ms evita conflito com o scroll
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const findBlock = (itemId: string) =>
    blocks.find((b) => b.id === itemId) ?? blocks.find((b) => b.entries.some((e) => e.uid === itemId))

  function onDragStart(e: DragStartEvent) {
    snapshot.current = blocks
    dragging.current = true
    setDragId(String(e.active.id))
  }

  // Ao passar para outro bloco, já move a música para lá (pré-visualização)
  function onDragOver({ active, over }: DragOverEvent) {
    const activeId = String(active.id)
    if (!over || activeId.startsWith(LIB_PREFIX)) return
    const from = findBlock(activeId)
    const to = findBlock(String(over.id))
    if (!from || !to || from.id === to.id) return
    const entry = from.entries.find((e) => e.uid === activeId)!
    const overIndex = to.entries.findIndex((e) => e.uid === over.id)
    const insertAt = overIndex >= 0 ? overIndex : to.entries.length
    setBlocks(
      blocks.map((b) => {
        if (b.id === from.id) return { ...b, entries: b.entries.filter((e) => e.uid !== activeId) }
        if (b.id === to.id) {
          const entries = [...b.entries]
          entries.splice(insertAt, 0, entry)
          return { ...b, entries }
        }
        return b
      }),
      false,
    )
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setDragId(null)
    dragging.current = false
    const activeId = String(active.id)
    if (!over) {
      if (snapshot.current) setBlocks(snapshot.current, false)
      return
    }
    const to = findBlock(String(over.id))
    if (!to) return

    if (activeId.startsWith(LIB_PREFIX)) {
      const songId = activeId.slice(LIB_PREFIX.length)
      const overIndex = to.entries.findIndex((e) => e.uid === over.id)
      const entries = [...to.entries]
      entries.splice(overIndex >= 0 ? overIndex : entries.length, 0, { uid: uid(), songId })
      setBlocks(blocks.map((b) => (b.id === to.id ? { ...b, entries } : b)))
      setActiveBlockId(to.id)
      return
    }

    const oldIndex = to.entries.findIndex((e) => e.uid === activeId)
    const newIndex = to.entries.findIndex((e) => e.uid === over.id)
    const entries = oldIndex >= 0 && newIndex >= 0 ? arrayMove(to.entries, oldIndex, newIndex) : to.entries
    setBlocks(blocks.map((b) => (b.id === to.id ? { ...b, entries } : b)))
  }

  function addToActiveBlock(songId: string) {
    const target = blocks.find((b) => b.id === activeBlockId) ?? blocks[blocks.length - 1]
    if (!target) return
    setBlocks(blocks.map((b) => (b.id === target.id ? { ...b, entries: [...b.entries, { uid: uid(), songId }] } : b)))
  }

  function addBlock() {
    const block: Block = { id: uid(), name: `Bloco ${blocks.length + 1}`, entries: [] }
    setBlocks([...blocks, block])
    setActiveBlockId(block.id)
  }

  const usedIds = new Set(blocks.flatMap((b) => b.entries.map((e) => e.songId)))
  const q = query.toLowerCase()
  const libSongs = songs.filter((s) => !q || `${s.title} ${s.artist}`.toLowerCase().includes(q))
  const total = blocks.reduce((t, b) => t + blockDuration(b, songMap), 0)
  const count = blocks.reduce((n, b) => n + b.entries.length, 0)

  // Índice global da música no show, para abrir o modo palco direto nela
  let globalIndex = 0
  const startIndexes = new Map<string, number>()
  for (const b of blocks) for (const e of b.entries) startIndexes.set(e.uid, globalIndex++)

  const dragSong = dragId
    ? songMap.get(dragId.startsWith(LIB_PREFIX) ? dragId.slice(LIB_PREFIX.length) : findBlock(dragId)?.entries.find((e) => e.uid === dragId)?.songId ?? '')
    : undefined

  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="field min-w-48 flex-1">Show
          <input className="input text-lg font-semibold" value={show.name} onChange={(e) => save({ name: e.target.value })} />
        </label>
        <label className="field">Data
          <input className="input" type="date" value={show.date} onChange={(e) => save({ date: e.target.value })} />
        </label>
        <label className="field min-w-40 flex-1">Local
          <input className="input" value={show.venue} onChange={(e) => save({ venue: e.target.value })} />
        </label>
        <Link to={`/palco/show/${show.id}`} className={`btn btn-primary ${count ? '' : 'pointer-events-none opacity-40'}`}>▶ Tocar show</Link>
      </div>
      <p className="mb-4 text-sm text-zinc-400">{count} músicas · {formatTotal(total)}{show.updatedBy && ` · última edição por ${show.updatedBy}`}</p>

      <DndContext sensors={sensors} collisionDetection={closestCorners}
        onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
        onDragCancel={() => { setDragId(null); dragging.current = false; if (snapshot.current) setBlocks(snapshot.current, false) }}>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <aside className="rounded-lg bg-zinc-900 p-3 md:sticky md:top-16 md:max-h-[calc(100dvh-5rem)] md:overflow-y-auto">
            <h2 className="mb-2 font-semibold">Biblioteca</h2>
            <input className="input mb-2 w-full" placeholder="Buscar…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <p className="mb-2 text-xs text-zinc-500">Arraste pelo ⠿ ou toque em + para adicionar ao bloco selecionado.</p>
            {songs.length === 0 && <p className="text-sm text-zinc-400">Sem músicas. <Link to="/" className="underline">Adicione PDFs</Link>.</p>}
            <ul className="space-y-1">
              {libSongs.map((s) => (
                <LibraryItem key={s.id} song={s} used={usedIds.has(s.id)} onAdd={() => addToActiveBlock(s.id)} />
              ))}
            </ul>
          </aside>

          <div className="space-y-4">
            {blocks.map((b, bi) => (
              <BlockColumn
                key={b.id}
                block={b}
                songMap={songMap}
                active={b.id === activeBlockId}
                onSelect={() => setActiveBlockId(b.id)}
                onRename={(name) => setBlocks(blocks.map((x) => (x.id === b.id ? { ...x, name } : x)))}
                onRemoveEntry={(entryUid) =>
                  setBlocks(blocks.map((x) => (x.id === b.id ? { ...x, entries: x.entries.filter((e) => e.uid !== entryUid) } : x)))}
                onMove={(dir) => {
                  const j = bi + dir
                  if (j >= 0 && j < blocks.length) setBlocks(arrayMove(blocks, bi, j))
                }}
                onDelete={() => {
                  if (b.entries.length && !confirm(`Excluir "${b.name}" e suas ${b.entries.length} músicas do show?`)) return
                  setBlocks(blocks.filter((x) => x.id !== b.id))
                }}
                playHref={(entry) => `/palco/show/${show.id}?i=${startIndexes.get(entry.uid) ?? 0}`}
              />
            ))}
            <button className="btn w-full border-2 border-dashed border-zinc-700" onClick={addBlock}>+ Adicionar bloco</button>
          </div>
        </div>

        <DragOverlay>
          {dragSong && (
            <div className="rounded-lg bg-amber-500 px-3 py-2 font-medium text-black shadow-2xl">{dragSong.title}</div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function LibraryItem({ song, used, onAdd }: { song: Song; used: boolean; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: LIB_PREFIX + song.id })
  return (
    <li ref={setNodeRef} className={`flex items-center gap-2 rounded bg-zinc-800 px-2 py-1.5 ${isDragging ? 'opacity-40' : ''}`}>
      <span {...listeners} {...attributes} className="drag-handle">⠿</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${used ? 'text-zinc-500' : ''}`}>{song.title}{used && ' ✓'}</div>
        {song.artist && <div className="truncate text-xs text-zinc-500">{song.artist}</div>}
      </div>
      <button className="btn px-3" onClick={onAdd} aria-label={`Adicionar ${song.title}`}>+</button>
    </li>
  )
}

function BlockColumn({
  block, songMap, active, onSelect, onRename, onRemoveEntry, onMove, onDelete, playHref,
}: {
  block: Block
  songMap: Map<string, Song>
  active: boolean
  onSelect: () => void
  onRename: (name: string) => void
  onRemoveEntry: (uid: string) => void
  onMove: (dir: 1 | -1) => void
  onDelete: () => void
  playHref: (e: SetEntry) => string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: block.id })
  return (
    <section
      onClick={onSelect}
      className={`rounded-lg border-2 bg-zinc-900 p-3 transition-colors ${active ? 'border-amber-500' : 'border-transparent'} ${isOver ? 'bg-zinc-800' : ''}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <input className="input flex-1 font-semibold" value={block.name} onChange={(e) => onRename(e.target.value)} />
        <span className="text-sm whitespace-nowrap text-zinc-400">
          {block.entries.length} · {formatTotal(blockDuration(block, songMap))}
        </span>
        <button className="btn px-2" onClick={() => onMove(-1)} aria-label="Subir bloco">↑</button>
        <button className="btn px-2" onClick={() => onMove(1)} aria-label="Descer bloco">↓</button>
        <button className="btn px-2 text-red-400" onClick={onDelete} aria-label="Excluir bloco">✕</button>
      </div>
      <SortableContext items={block.entries.map((e) => e.uid)} strategy={verticalListSortingStrategy}>
        <ol ref={setNodeRef} className="min-h-12 space-y-1">
          {block.entries.map((e, i) => (
            <EntryRow key={e.uid} entry={e} index={i} song={songMap.get(e.songId)} href={playHref(e)} onRemove={() => onRemoveEntry(e.uid)} />
          ))}
          {block.entries.length === 0 && (
            <li className="rounded border border-dashed border-zinc-700 p-3 text-center text-sm text-zinc-500">Arraste músicas para cá</li>
          )}
        </ol>
      </SortableContext>
    </section>
  )
}

function EntryRow({ entry, index, song, href, onRemove }: { entry: SetEntry; index: number; song?: Song; href: string; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.uid })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded bg-zinc-800 px-2 py-1.5 ${isDragging ? 'opacity-40' : ''}`}
    >
      <span {...listeners} {...attributes} className="drag-handle">⠿</span>
      <span className="w-6 text-right text-sm text-zinc-500">{index + 1}</span>
      <Link to={href} className="min-w-0 flex-1">
        <div className="truncate">{song?.title ?? 'Música removida'}</div>
        <div className="truncate text-xs text-zinc-500">
          {[song?.artist, song?.key && `Tom ${song.key}`, formatDuration(song?.durationSec)].filter(Boolean).join(' · ')}
        </div>
      </Link>
      <button className="btn px-2 text-zinc-400" onClick={onRemove} aria-label="Remover do bloco">✕</button>
    </li>
  )
}

function blockDuration(block: Block, songMap: Map<string, Song>) {
  return block.entries.reduce((t, e) => t + (songMap.get(e.songId)?.durationSec ?? 0), 0)
}
