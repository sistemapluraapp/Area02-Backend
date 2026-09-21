import { createClient } from '@supabase/supabase-js'
import type { Context } from 'hono'

type Env = {
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

export function getSupabaseClient(c: Context<{ Bindings: Env }>) {
  return createClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY)
}
