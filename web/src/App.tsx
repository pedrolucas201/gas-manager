import { useEffect, useState } from 'react'
import { type User } from 'firebase/auth'
import { onAuth } from './auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    return onAuth(setUser)
  }, [])

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    )
  }

  if (!user) return <Login />
  return <Dashboard user={user} />
}
