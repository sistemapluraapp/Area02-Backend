import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { requireAuth } from './middleware/auth'
import { login, signup, refresh } from './routes/auth'
import { criarPagina, minhasPaginas, obterPagina, atualizarPagina, uploadLogo, uploadCapa, adicionarFoto, removerFoto } from './routes/paginas'
import { convidarColaborador, removerColaborador } from './routes/colaboradores'
import { responderAvaliacao } from './routes/avaliacoes'
import { solicitarCertificado, listarCertificados } from './routes/certificados'
import {
  listarNotificacoes,
  contagemNaoLidas,
  marcarComoLida,
  marcarTodasComoLidas,
} from './routes/notificacoes'
import type { AppEnv } from './types'

const app = new Hono<AppEnv>()

app.use('*', cors())

app.get('/health', (c) => c.json({ status: 'ok', area: c.env.AREA, service: 'backend' }))

app.post('/auth/login', login)
app.post('/auth/signup', signup)
app.post('/auth/refresh', refresh)

app.use('*', async (c, next) => {
  if (
    c.req.path === '/health' ||
    c.req.path === '/auth/login' ||
    c.req.path === '/auth/signup' ||
    c.req.path === '/auth/refresh'
  )
    return next()
  return requireAuth(c, next)
})

app.post('/paginas', criarPagina)
app.get('/minhas-paginas', minhasPaginas)
app.get('/paginas/:id', obterPagina)
app.put('/paginas/:id', atualizarPagina)
app.post('/paginas/:id/logo', uploadLogo)
app.post('/paginas/:id/capa', uploadCapa)
app.post('/paginas/:id/fotos', adicionarFoto)
app.delete('/paginas/:id/fotos', removerFoto)

app.post('/paginas/:id/colaboradores', convidarColaborador)
app.delete('/paginas/:id/colaboradores/:vinculoId', removerColaborador)

app.patch('/avaliacoes/:id/resposta', responderAvaliacao)

app.post('/paginas/:id/certificados', solicitarCertificado)
app.get('/paginas/:id/certificados', listarCertificados)

app.get('/notificacoes', listarNotificacoes)
app.get('/notificacoes/contagem-nao-lidas', contagemNaoLidas)
app.patch('/notificacoes/:id/ler', marcarComoLida)
app.patch('/notificacoes/marcar-todas-lidas', marcarTodasComoLidas)

export default app
