import axios from 'axios'
import { supabase } from './supabase.js'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api'
})

api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

export default api
