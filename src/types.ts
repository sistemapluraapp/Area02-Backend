import type { SupabaseClient } from '@supabase/supabase-js'

export type Bindings = {
  CSC_API_KEY?: string
  SUPABASE_URL: string
  FRONTEND_URL: string
  SUPABASE_ANON_KEY: string
  AREA: string
  RESEND_API_KEY: string
  // Remetente dos e-mails (ex.: "Plura <nao-responda@plura.app.br>")
  EMAIL_REMETENTE?: string
}

export type Variables = {
  supabase: SupabaseClient
  userId: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
