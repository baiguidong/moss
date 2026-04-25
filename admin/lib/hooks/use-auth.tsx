'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getMe, login as apiLogin, loginWithApiKey, logout as apiLogout, isAuthenticated } from '@/lib/api/auth'
import type { AuthUser } from '@/lib/api/types'

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  loginWithKey: (apiKey: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const checkAuth = useCallback(async () => {
    if (!isAuthenticated()) {
      setIsLoading(false)
      return
    }

    try {
      const response = await getMe()
      setUser(response.user)
    } catch {
      localStorage.removeItem('moss_access_token')
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  const login = async (username: string, password: string) => {
    const response = await apiLogin(username, password)
    setUser(response.user)
  }

  const loginWithKey = async (apiKey: string) => {
    const response = await loginWithApiKey(apiKey)
    setUser(response.user)
  }

  const logout = async () => {
    await apiLogout()
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        loginWithKey,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
