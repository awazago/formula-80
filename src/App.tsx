import { useEffect } from 'react'
import { BrowserRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { Library } from './pages/Library'
import { Shows } from './pages/Shows'
import { ShowEditor } from './pages/ShowEditor'
import { ShowStage, SongStage } from './pages/Stage'
import { Login } from './pages/Login'
import { AccountMenu, SyncBadge } from './components/AccountMenu'
import { useSession, type Session } from './lib/api'
import { startAutoSync } from './lib/sync'

function Layout({ session }: { session: Session }) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <span className="mr-2 font-bold tracking-tight sm:mr-4">
          Fórmula <span className="text-amber-500">80</span>
        </span>
        <NavLink to="/" end className={tab}>Músicas</NavLink>
        <NavLink to="/shows" className={tab}>Shows</NavLink>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SyncBadge />
          <AccountMenu session={session} />
        </div>
      </header>
      <Outlet />
    </div>
  )
}

export default function App() {
  const session = useSession()

  useEffect(() => {
    if (session) return startAutoSync()
  }, [session])

  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout session={session} />}>
          <Route path="/" element={<Library />} />
          <Route path="/shows" element={<Shows />} />
          <Route path="/shows/:id" element={<ShowEditor />} />
        </Route>
        <Route path="/palco/show/:id" element={<ShowStage />} />
        <Route path="/palco/musica/:id" element={<SongStage />} />
      </Routes>
    </BrowserRouter>
  )
}
