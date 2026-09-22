import type { SupabaseClient } from '@supabase/supabase-js'

const EXTENSOES_VALIDAS = ['jpg', 'jpeg', 'png', 'webp']
const TAMANHO_MAXIMO = 5 * 1024 * 1024 // 5MB

export async function uploadFotoPagina(
  supabase: SupabaseClient,
  paginaId: string,
  nomeArquivo: string,
  imagemBase64: string,
  extensao: string
): Promise<{ url?: string; erro?: string }> {
  if (!EXTENSOES_VALIDAS.includes(extensao)) {
    return { erro: 'Extensão inválida. Use jpg, jpeg, png ou webp.' }
  }

  const bytes = Uint8Array.from(atob(imagemBase64), (c) => c.charCodeAt(0))
  if (bytes.length > TAMANHO_MAXIMO) {
    return { erro: 'A imagem deve ter no máximo 5MB.' }
  }

  const path = `${paginaId}/${nomeArquivo}.${extensao}`
  const contentType = `image/${extensao === 'jpg' ? 'jpeg' : extensao}`

  const { error } = await supabase.storage.from('paginas-fotos').upload(path, bytes, { contentType, upsert: true })
  if (error) return { erro: error.message }

  const { data } = supabase.storage.from('paginas-fotos').getPublicUrl(path)
  return { url: data.publicUrl }
}
