// Canais de contato da página, com um marcado como preferencial.
// O link é montado conforme o canal quando a empresa digita só o valor
// (e-mail, telefone, @ do Instagram…).

export const CANAIS_CONTATO = ['whatsapp', 'ligacao', 'email', 'sms', 'instagram', 'site', 'presencial', 'outro'] as const
type Canal = (typeof CANAIS_CONTATO)[number]

export interface Contato {
  canal: Canal
  titulo: string
  descricao: string | null
  link: string | null
  preferencial: boolean
}

const MAX_CONTATOS = 12

function telefoneBr(valor: string): string | null {
  let d = valor.replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  return d.length === 10 || d.length === 11 ? `55${d}` : null
}

function montarLink(canal: Canal, bruto: string): string | null {
  const v = bruto.trim()
  if (!v) return null
  if (/^(https:|mailto:|tel:|sms:)/i.test(v)) return v
  if (/^http:/i.test(v)) return v.replace(/^http:/i, 'https:')
  switch (canal) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : null
    case 'ligacao':
    case 'sms': {
      const tel = telefoneBr(v)
      return tel ? `${canal === 'sms' ? 'sms' : 'tel'}:+${tel}` : null
    }
    case 'whatsapp': {
      const tel = telefoneBr(v)
      return tel ? `https://wa.me/${tel}` : null
    }
    case 'instagram':
      return `https://instagram.com/${v.replace(/^@/, '')}`
    default:
      return `https://${v}`
  }
}

export function validarContatos(valor: unknown): { contatos: Contato[]; erro?: undefined } | { erro: string; contatos?: undefined } {
  if (!Array.isArray(valor)) return { erro: 'contatos deve ser uma lista' }
  if (valor.length > MAX_CONTATOS) return { erro: `Cadastre no máximo ${MAX_CONTATOS} canais de contato` }
  const contatos: Contato[] = []
  let temPreferencial = false
  for (const [i, item] of valor.entries()) {
    if (typeof item !== 'object' || item === null) return { erro: `Contato ${i + 1} inválido` }
    const { canal, titulo, descricao, link, preferencial } = item as Record<string, unknown>
    if (typeof canal !== 'string' || !CANAIS_CONTATO.includes(canal as Canal)) return { erro: `Canal inválido no contato ${i + 1}` }
    const t = typeof titulo === 'string' ? titulo.trim() : ''
    if (!t) return { erro: `Informe o título do contato ${i + 1}` }
    if (t.length > 80) return { erro: `O título do contato ${i + 1} deve ter no máximo 80 caracteres` }
    const d = typeof descricao === 'string' ? descricao.trim() : ''
    if (d.length > 300) return { erro: `A descrição do contato ${i + 1} deve ter no máximo 300 caracteres` }
    const bruto = typeof link === 'string' ? link : ''
    if (bruto.length > 300) return { erro: `O link do contato ${i + 1} é longo demais` }
    const linkFinal = montarLink(canal as Canal, bruto)
    if (bruto.trim() && !linkFinal) return { erro: `Link ou valor inválido no contato "${t}"` }
    // Só um canal preferencial: vale o primeiro marcado
    const pref = preferencial === true && !temPreferencial
    if (pref) temPreferencial = true
    contatos.push({ canal: canal as Canal, titulo: t, descricao: d || null, link: linkFinal, preferencial: pref })
  }
  return { contatos }
}
