# Area02-Backend

Backend da Área 02 (B2B — Empreendimentos) da Plura — Hono em Cloudflare Workers.

Funções desta área:
- Criar Página (tipo `privada`)
- Monitorar a própria Página
- Participar de outras Páginas como colaborador
- Avaliar e responder comentários
- Consultar status de verificações (Certificado de Acessibilidade)
- Upload de fotos e informações da Página

Banco de dados: Supabase `grupo.01` (`https://uoembacxxnkuwldmdgcu.supabase.co`).

## Deploy
O workflow `.github/workflows/deploy.yml` roda `wrangler deploy` a cada push.
Precisa dos secrets do repositório: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Secrets do Worker (nunca no código)
```
wrangler secret put SUPABASE_ANON_KEY
```
