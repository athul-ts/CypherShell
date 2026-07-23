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
