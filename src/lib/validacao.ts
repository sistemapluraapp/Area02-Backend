// Validações de campos da página do empreendimento (compartilhado Áreas 02/03).

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '')
}

// CNPJ: 14 dígitos com os dois dígitos verificadores corretos.
export function cnpjValido(valor: string): boolean {
  const cnpj = somenteDigitos(valor)
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false

  const calcular = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0)
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }

  const d1 = calcular(cnpj.slice(0, 12))
  const d2 = calcular(cnpj.slice(0, 12) + d1)
  return cnpj.endsWith(`${d1}${d2}`)
}

// WhatsApp brasileiro: DDD + número (10 ou 11 dígitos), com ou sem 55 na frente.
export function normalizarWhatsapp(valor: string): string | null {
  let digitos = somenteDigitos(valor)
  if (digitos.length === 12 || digitos.length === 13) {
    if (!digitos.startsWith('55')) return null
    digitos = digitos.slice(2)
  }
  if (digitos.length !== 10 && digitos.length !== 11) return null
  return `55${digitos}`
}

export function urlValida(valor: string): boolean {
  try {
    const url = new URL(valor)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function youtubeValido(valor: string): boolean {
  if (!urlValida(valor)) return false
  const host = new URL(valor).hostname.replace(/^www\.|^m\./, '')
  return host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com'
}

// Identifica a plataforma de um link da galeria (vídeo, reel, 360°, tour virtual)
export function plataformaDoLink(valor: string): string {
  const host = new URL(valor).hostname.replace(/^www\.|^m\./, '')
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube'
  if (host.endsWith('instagram.com')) return 'instagram'
  if (host.endsWith('tiktok.com')) return 'tiktok'
  if (host.endsWith('facebook.com') || host === 'fb.watch') return 'facebook'
  if (host.endsWith('vimeo.com')) return 'vimeo'
  if (host.endsWith('kuula.co')) return 'kuula'
  if (host.endsWith('matterport.com')) return 'matterport'
  if (host.startsWith('google.') || host.endsWith('.google.com') || host === 'goo.gl' || host === 'maps.app.goo.gl') return 'google'
  return 'outro'
}

export const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] as const
export type Turno = { abre: string; fecha: string }
export type Horarios = Partial<Record<(typeof DIAS_SEMANA)[number], Turno[]>>

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

// horarios: { seg: [{ abre: '11:00', fecha: '15:00' }, ...], ... } — até 2
// turnos por dia; dia ausente ou lista vazia = fechado. fecha < abre indica
// que o turno passa da meia-noite.
export function validarHorarios(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return 'horarios deve ser um objeto'
  for (const [dia, turnos] of Object.entries(valor)) {
    if (!DIAS_SEMANA.includes(dia as (typeof DIAS_SEMANA)[number])) return `Dia inválido em horarios: ${dia}`
    if (!Array.isArray(turnos) || turnos.length > 2) return `horarios.${dia} deve ter no máximo 2 turnos`
    for (const t of turnos) {
      if (!t || !HORA.test(t.abre) || !HORA.test(t.fecha)) return `Horário inválido em ${dia} (use HH:MM)`
    }
  }
  return null
}

export const CAMPOS_SEGURANCA = [
  'informacoes',
  'requisitos',
  'equipamentos',
  'profissionais',
  'procedimentos',
  'contatos_emergencia',
] as const

export function validarObjetoDeTextos(valor: unknown, nome: string, chavesPermitidas?: readonly string[]): string | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return `${nome} deve ser um objeto`
  for (const [chave, texto] of Object.entries(valor)) {
    if (chavesPermitidas && !chavesPermitidas.includes(chave)) return `Campo inválido em ${nome}: ${chave}`
    if (typeof texto !== 'string') return `${nome}.${chave} deve ser texto`
  }
  return null
}
