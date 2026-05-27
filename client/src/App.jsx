import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import Sidebar from './components/Sidebar.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Upload from './pages/Upload.jsx'
import JobDetail from './pages/JobDetail.jsx'

function AuthLayout({ session, children }) {
  if (session === undefined) return null
  if (!session) return <Navigate to="/login" replace />
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ marginLeft: 220, flex: 1, minWidth: 0 }}>
        {children}
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setSession(session ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route
          path="/dashboard"
          element={<AuthLayout session={session}><Dashboard /></AuthLayout>}
        />
        <Route
          path="/upload"
          element={<AuthLayout session={session}><Upload /></AuthLayout>}
        />
        <Route
          path="/jobs/:id"
          element={<AuthLayout session={session}><JobDetail /></AuthLayout>}
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
