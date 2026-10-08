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
  // Bucket R2 dos arquivos das inscrições em certificações (8c)
  CERTIFICACOES: R2Bucket
}

export type Variables = {
  supabase: SupabaseClient
  userId: string
  // Vínculo de quem chama com a página da rota (middleware de acesso)
  acesso: import('./lib/acesso').Acesso
  // Texto do log da página quando a rota quer algo mais específico
  acaoLog: string
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }
