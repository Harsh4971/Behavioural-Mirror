import axios from "axios"
import { supabase } from "./supabase"

const BASE_URL = import.meta.env.VITE_API_URL
if (!BASE_URL) throw new Error("VITE_API_URL is not set — check your .env file")

const api = axios.create({ baseURL: BASE_URL })

api.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  return config
})

export default api
