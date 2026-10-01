-- Etapa 1: contatos com preferência, link do Google Maps, lixeira de páginas
-- e descrição dos itens de catálogo ("Antes de ir").

-- Canais de contato: [{ canal, titulo, descricao, link, preferencial }]
alter table public.paginas
  add column if not exists contatos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(contatos) = 'array' and jsonb_array_length(contatos) <= 12),
  add column if not exists mapa_link text
    check (char_length(mapa_link) <= 500 and mapa_link ~ '^https://'),
  add column if not exists localizacao_comentarios text
    check (char_length(localizacao_comentarios) <= 8000),
  -- Lixeira: preenchida ao apagar; após 30 dias a página é excluída de vez
  add column if not exists excluida_em timestamptz;

create index if not exists paginas_excluida_em_idx on public.paginas (excluida_em) where excluida_em is not null;

-- Página na lixeira some para o público; só os administradores dela a veem
alter policy paginas_select_public on public.paginas
  using (excluida_em is null or internal.tem_vinculo(id, array['administrador'::papel_vinculo]));

-- Descrição opcional dos itens de catálogo (ex.: tópicos de "Antes de ir")
alter table public.catalogo_itens
  add column if not exists descricao text check (char_length(descricao) <= 500);

-- Exclusão definitiva das páginas na lixeira há mais de 30 dias
-- (chamada pelo cron diário da Área 04). Tabelas filhas apagam em cascata.
create or replace function internal.purgar_paginas_excluidas()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  total integer;
begin
  delete from public.paginas where excluida_em < now() - interval '30 days';
  get diagnostics total = row_count;
  return total;
end;
$$;

revoke all on function internal.purgar_paginas_excluidas() from public;
grant usage on schema internal to area04_backend;
grant execute on function internal.purgar_paginas_excluidas() to area04_backend;
