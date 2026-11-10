import axios from 'axios'

// Global Window.api type is declared in src/preload/index.d.ts
// (shared across all renderer files). Do NOT redeclare it here.

const BASE_URL = `http://127.0.0.1:${window.api?.backendPort ?? 4000}/api`

export const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('jwt')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null

/**
 * Registers what happens when the backend rejects the session token — it
 * expired (1 h), was revoked by a lock, or the backend restarted (BL-16).
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

api.interceptors.response.use(undefined, (error) => {
  const status: number | undefined = error?.response?.status
  const url: string = error?.config?.url ?? ''
  // A 401 from an /auth endpoint is a wrong password, not an expired session.
  if (status === 401 && !url.startsWith('/auth/')) onUnauthorized?.()
  return Promise.reject(error)
})
