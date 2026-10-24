// API do Fórmula 80 Setlist: músicas e shows no D1, PDFs no KV.
// Tudo que não começa com /api/ é servido pelos arquivos estáticos (o app).

interface Env {
  DB: D1Database
  PDFS: KVNamespace
}

interface SongRow {
  id: string
  title: string
  artist: string
  key: string
  bpm: number | null
  duration_sec: number | null
  patch: string
  notes: string
  file_name: string
  file_version: number
  created_at: number
  updated_at: number
  updated_by: string
  deleted: number
}

interface ShowRow {
  id: string
  name: string
  date: string
  venue: string
  blocks: string
  created_at: number
  updated_at: number
  updated_by: string
  deleted: number
}

const MAX_PDF_BYTES = 20 * 1024 * 1024

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    try {
      return await route(request, env, url)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(err)
      return json({ error: 'Erro interno' }, 500)
    }
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url
  const method = request.method

  if (pathname === '/api/login' && method === 'POST') return login(request, env)

  const user = await authenticate(request, env)

  if (pathname === '/api/sync' && method === 'GET') {
    // Sobreposição de 1 min no cliente cobre escritas concorrentes; aqui é só o filtro.
    const since = Number(url.searchParams.get('since') ?? 0) || 0
    const now = Date.now()
    const [songs, shows] = await Promise.all([
      env.DB.prepare('SELECT * FROM songs WHERE updated_at > ? ORDER BY updated_at').bind(since).all<SongRow>(),
      env.DB.prepare('SELECT * FROM shows WHERE updated_at > ? ORDER BY updated_at').bind(since).all<ShowRow>(),
    ])
    return json({ now, songs: songs.results.map(songOut), shows: shows.results.map(showOut) })
  }

  if (pathname === '/api/band-code' && method === 'POST') {
    const body = await readJson<{ current?: string; next?: string }>(request)
    if (!(await checkBandCode(env, body.current ?? ''))) throw new HttpError(403, 'Código atual incorreto')
    const next = (body.next ?? '').trim()
    if (next.length < 6) throw new HttpError(400, 'O novo código precisa ter pelo menos 6 caracteres')
    await setBandCode(env, next)
    // Derruba as outras sessões: todos entram de novo com o código novo
    await env.DB.prepare('DELETE FROM sessions WHERE token != ?').bind(user.token).run()
    return json({ ok: true })
  }

  if (pathname === '/api/logout' && method === 'POST') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(user.token).run()
    return json({ ok: true })
  }

  const songPdf = pathname.match(/^\/api\/songs\/([\w-]+)\/pdf$/)
  if (songPdf) {
    const id = songPdf[1]
    if (method === 'GET') {
      const pdf = await env.PDFS.get(`pdf:${id}`, 'stream')
      if (!pdf) throw new HttpError(404, 'PDF não encontrado')
      return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } })
    }
    if (method === 'PUT') {
      const size = Number(request.headers.get('content-length') ?? 0)
      if (size > MAX_PDF_BYTES) throw new HttpError(413, 'PDF acima de 20 MB')
      const data = await request.arrayBuffer()
      if (data.byteLength > MAX_PDF_BYTES) throw new HttpError(413, 'PDF acima de 20 MB')
      const exists = await env.DB.prepare('SELECT id FROM songs WHERE id = ?').bind(id).first()
      if (!exists) throw new HttpError(404, 'Envie a música antes do PDF')
      await env.PDFS.put(`pdf:${id}`, data)
      const now = Date.now()
      const fileName = decodeURIComponent(request.headers.get('x-file-name') ?? '')
      await env.DB.prepare('UPDATE songs SET file_version = ?, file_name = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .bind(now, fileName, now, user.name, id)
        .run()
      return json({ fileVersion: now, updatedAt: now })
    }
  }

  const song = pathname.match(/^\/api\/songs\/([\w-]+)$/)
  if (song && method === 'PUT') {
    const id = song[1]
    const s = await readJson<Record<string, unknown>>(request)
    const now = Date.now()
    const deleted = s.deleted ? 1 : 0
    await env.DB.prepare(
      `INSERT INTO songs (id, title, artist, key, bpm, duration_sec, patch, notes, created_at, updated_at, updated_by, deleted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
       ON CONFLICT(id) DO UPDATE SET title = ?2, artist = ?3, key = ?4, bpm = ?5, duration_sec = ?6, patch = ?7,
         notes = ?8, updated_at = ?10, updated_by = ?11, deleted = ?12`,
    )
      .bind(
        id, str(s.title, 'Sem título'), str(s.artist), str(s.key), int(s.bpm), int(s.durationSec), str(s.patch),
        str(s.notes), int(s.createdAt) ?? now, now, user.name, deleted,
      )
      .run()
    if (deleted) await env.PDFS.delete(`pdf:${id}`)
    return json({ updatedAt: now })
  }

  const show = pathname.match(/^\/api\/shows\/([\w-]+)$/)
  if (show && method === 'PUT') {
    const id = show[1]
    const s = await readJson<Record<string, unknown>>(request)
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO shows (id, name, date, venue, blocks, created_at, updated_at, updated_by, deleted)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(id) DO UPDATE SET name = ?2, date = ?3, venue = ?4, blocks = ?5, updated_at = ?7,
         updated_by = ?8, deleted = ?9`,
    )
      .bind(
        id, str(s.name, 'Show'), str(s.date), str(s.venue), JSON.stringify(Array.isArray(s.blocks) ? s.blocks : []),
        int(s.createdAt) ?? now, now, user.name, s.deleted ? 1 : 0,
      )
      .run()
    return json({ updatedAt: now })
  }

  throw new HttpError(404, 'Rota não encontrada')
}

// ---------- Autenticação por código da banda ----------

async function login(request: Request, env: Env) {
  const { name, code } = await readJson<{ name?: string; code?: string }>(request)
  const cleanName = (name ?? '').trim().slice(0, 40)
  if (!cleanName) throw new HttpError(400, 'Informe seu nome')
  if (!(await checkBandCode(env, code ?? ''))) throw new HttpError(403, 'Código da banda incorreto')
  const token = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO sessions (token, name, created_at) VALUES (?, ?, ?)')
    .bind(token, cleanName, Date.now())
    .run()
  return json({ token, name: cleanName })
}

async function authenticate(request: Request, env: Env) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Faça login')
  const row = await env.DB.prepare('SELECT name FROM sessions WHERE token = ?').bind(token).first<{ name: string }>()
  if (!row) throw new HttpError(401, 'Sessão expirada, faça login de novo')
  return { token, name: row.name }
}

async function checkBandCode(env: Env, code: string) {
  const rows = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('band_code_hash', 'band_code_salt')")
    .all<{ key: string; value: string }>()
  const map = new Map(rows.results.map((r) => [r.key, r.value]))
  const hash = map.get('band_code_hash')
  const salt = map.get('band_code_salt')
  if (!hash || !salt) throw new HttpError(503, 'Código da banda ainda não configurado')
  return timingSafeEqual(await sha256(`${salt}:${code.trim()}`), hash)
}

async function setBandCode(env: Env, code: string) {
  const salt = crypto.randomUUID()
  const hash = await sha256(`${salt}:${code}`)
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('band_code_salt', ?)").bind(salt),
    env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('band_code_hash', ?)").bind(hash),
  ])
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ---------- Utilidades ----------

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.slice(0, 2000) : fallback
}

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : Math.round(n)
}

function songOut(r: SongRow) {
  return {
    id: r.id, title: r.title, artist: r.artist, key: r.key, bpm: r.bpm ?? undefined,
    durationSec: r.duration_sec ?? undefined, patch: r.patch, notes: r.notes, fileName: r.file_name,
    fileVersion: r.file_version, createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by,
    deleted: !!r.deleted,
  }
}

function showOut(r: ShowRow) {
  return {
    id: r.id, name: r.name, date: r.date, venue: r.venue, blocks: JSON.parse(r.blocks),
    createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by, deleted: !!r.deleted,
  }
}
