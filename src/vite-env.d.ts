/// <reference types="vite/client" />

import type { SupabaseClient } from '@supabase/supabase-js'

declare global {
  interface Window {
    __SUPABASE_CLIENT__?: SupabaseClient
    __SUPABASE_CONFIG__?: {
      url: string
      anonKey: string
      bucket?: string
    }
  }
}

export {}

