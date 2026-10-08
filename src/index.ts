import { acaoInscricao, baixarArquivo, enviarArquivo, removerArquivo, inscreverPagina, listarCertificacoesPublicadas, listarInscricoes, obterCertificacaoPublicada, obterInscricao, salvarResposta } from './routes/certificacoes'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireAuth } from './middleware/auth'
import { login, signup, refresh } from './routes/auth'
import { criarPagina, minhasPaginas, obterPagina, atualizarPagina, uploadLogo, uploadCapa, excluirPagina, restaurarPagina } from './routes/paginas'
import { adicionarFoto, adicionarLink, atualizarMidia, removerMidia } from './routes/midias'
import { criarExperiencia, atualizarExperiencia, removerExperiencia, uploadImagemExperiencia } from './routes/experiencias'
import { atualizarEvento, criarEvento, interessadosEvento, listarEventos, removerEvento, uploadImagemEvento } from './routes/eventos'
import { listarOpcoes, obterTermo } from './routes/opcoes'
import { atualizarColaborador, convidarColaborador, listarEquipe, listarLogs, meusConvites, reenviarConvite, removerColaborador, responderConvite } from './routes/colaboradores'
import { exigirAcessoPagina } from './lib/acesso'
import { responderAvaliacao } from './routes/avaliacoes'
import { solicitarCertificado, listarCertificados } from './routes/certificados'
import {
  listarNotificacoes,
  contagemNaoLidas,
  marcarComoLida,
  marcarTodasComoLidas,
} from './routes/notificacoes'
import { listarCidades, listarEstados } from './routes/localidades'
import { recuperarSenha, redefinirSenha } from './routes/senha'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok', area: c.env.AREA, service: 'backend' }))

app.post('/auth/login', login)
app.post('/auth/recuperar-senha', recuperarSenha)
app.post('/auth/redefinir-senha', redefinirSenha)
app.post('/auth/signup', signup)
app.post('/auth/refresh', refresh)

app.use('*', async (c, next) => {
  if (
    c.req.path === '/health' ||
    c.req.path === '/auth/login' ||
    c.req.path === '/auth/signup' ||
    c.req.path === '/auth/refresh' ||
    c.req.path === '/auth/recuperar-senha' ||
    c.req.path === '/auth/redefinir-senha'
  )
    return next()
  return requireAuth(c, next)
})

// Página desta área + equipe + permissão da aba + log (lib/acesso.ts)
app.use('/paginas/*', exigirAcessoPagina)

app.post('/paginas', criarPagina)
app.get('/minhas-paginas', minhasPaginas)
app.get('/paginas/:id', obterPagina)
app.put('/paginas/:id', atualizarPagina)
app.delete('/paginas/:id', excluirPagina)
app.post('/paginas/:id/restaurar', restaurarPagina)
app.post('/paginas/:id/logo', uploadLogo)
app.post('/paginas/:id/capa', uploadCapa)

app.post('/paginas/:id/midias/foto', adicionarFoto)
app.post('/paginas/:id/midias/link', adicionarLink)
app.patch('/paginas/:id/midias/:midiaId', atualizarMidia)
app.delete('/paginas/:id/midias/:midiaId', removerMidia)

app.post('/paginas/:id/experiencias', criarExperiencia)
app.put('/paginas/:id/experiencias/:experienciaId', atualizarExperiencia)
app.delete('/paginas/:id/experiencias/:experienciaId', removerExperiencia)
app.post('/paginas/:id/experiencias/:experienciaId/imagem', uploadImagemExperiencia)

app.get('/paginas/:id/eventos', listarEventos)
app.post('/paginas/:id/eventos', criarEvento)
app.put('/paginas/:id/eventos/:eventoId', atualizarEvento)
app.delete('/paginas/:id/eventos/:eventoId', removerEvento)
app.post('/paginas/:id/eventos/:eventoId/imagem', uploadImagemEvento)
app.get('/paginas/:id/eventos/:eventoId/interessados', interessadosEvento)

app.get('/opcoes', listarOpcoes)
app.get('/termos/:chave', obterTermo)
app.get('/localidades/:pais/estados', listarEstados)
app.get('/localidades/:pais/estados/:estado/cidades', listarCidades)

app.get('/paginas/:id/colaboradores', listarEquipe)
app.post('/paginas/:id/colaboradores', convidarColaborador)
app.patch('/paginas/:id/colaboradores/:vinculoId', atualizarColaborador)
app.post('/paginas/:id/colaboradores/:vinculoId/reenviar', reenviarConvite)

// Convites recebidos: a pessoa convidada aceita ou recusa
app.get('/convites-equipe', meusConvites)
app.post('/convites-equipe/:id/aceitar', responderConvite)
app.post('/convites-equipe/:id/recusar', responderConvite)
app.get('/paginas/:id/logs', listarLogs)
app.delete('/paginas/:id/colaboradores/:vinculoId', removerColaborador)

app.patch('/avaliacoes/:id/resposta', responderAvaliacao)

app.post('/paginas/:id/certificados', solicitarCertificado)
app.get('/certificacoes', listarCertificacoesPublicadas)
app.get('/certificacoes/:id', obterCertificacaoPublicada)
app.get('/paginas/:id/inscricoes', listarInscricoes)
app.post('/paginas/:id/inscricoes', inscreverPagina)
app.get('/paginas/:id/inscricoes/:inscricaoId', obterInscricao)
app.put('/paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId', salvarResposta)
app.post('/paginas/:id/inscricoes/:inscricaoId/enviar', acaoInscricao)
app.post('/paginas/:id/inscricoes/:inscricaoId/cancelar', acaoInscricao)
app.post('/paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos', enviarArquivo)
app.get('/paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos', baixarArquivo)
app.delete('/paginas/:id/inscricoes/:inscricaoId/respostas/:requisitoId/arquivos', removerArquivo)
app.get('/paginas/:id/certificados', listarCertificados)

app.get('/notificacoes', listarNotificacoes)
app.get('/notificacoes/contagem-nao-lidas', contagemNaoLidas)
app.patch('/notificacoes/:id/ler', marcarComoLida)
app.patch('/notificacoes/marcar-todas-lidas', marcarTodasComoLidas)

export default app
