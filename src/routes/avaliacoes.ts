import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { enviarEmail } from '../lib/email'
import { escaparHtml, montarAviso } from '../lib/emailLayout'

export async function responderAvaliacao(c: Context<AppEnv>) {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{ resposta?: string }>().catch(() => null)

  if (!body?.resposta) {
    return c.json({ error: 'Campo obrigatório: resposta' }, 400)
  }

  const { data, error } = await supabase
    .from('avaliacoes')
    .update({ resposta: body.resposta })
    .eq('id', id)
    .select('id, pagina_id, nota, comentario, resposta, respondido_em')
    .single()

  if (error) return c.json({ error: error.message }, 400)

  try {
    const { data: email, error: rpcError } = await supabase.rpc('notificar_resposta_avaliacao', {
      p_avaliacao_id: id,
      p_resposta: body.resposta,
    })

    if (!rpcError && email) {
      const trecho = body.resposta.length > 200 ? `${body.resposta.slice(0, 200)}…` : body.resposta
      await enviarEmail(
        c.env.RESEND_API_KEY,
        email,
        'Você recebeu uma resposta à sua avaliação na Plura',
        montarAviso(
          'Sua avaliação foi respondida',
          `<p>A página que você avaliou respondeu ao seu comentário:</p><p style="padding:12px 16px;border-left:4px solid #0062e6;background:#f2f6ff;">${escaparHtml(trecho)}</p>`,
          { texto: 'Ver na Plura', link: 'https://plura.app.br/perfil' },
        ),
        c.env.EMAIL_REMETENTE,
      )
    } else if (rpcError) {
      console.error('Erro ao notificar resposta de avaliação:', rpcError.message)
    }
  } catch (notificacaoError) {
    console.error('Erro ao processar notificação de resposta de avaliação:', notificacaoError)
  }

  return c.json(data)
}
