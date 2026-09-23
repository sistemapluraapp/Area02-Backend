-- =============================================================================
-- Fase 1b — Regras que mudam o comportamento do site em produção.
--
-- NÃO APLICAR antes de publicar em produção a versão nova dos frontends/
-- backends (formulário com CNPJ e tela de moderação da Área 04).
-- Pré-requisito: 20260923_fase1_empreendimentos.sql já aplicada.
-- =============================================================================

-- 1. CNPJ obrigatório para páginas novas.
--    Páginas criadas entre a fase 1 e este deploy (sem campo de CNPJ na
--    interface antiga) também ficam isentas, como as legadas.
alter table public.paginas disable trigger trg_protege_colunas_paginas;
update public.paginas set legado = true where cnpj is null;
alter table public.paginas enable trigger trg_protege_colunas_paginas;

alter table public.paginas
  add constraint paginas_cnpj_obrigatorio check (legado or cnpj is not null);

-- 2. Comentários nascem pendentes e só aparecem depois de aprovados.
alter table public.avaliacoes alter column status set default 'pendente';

drop policy avaliacoes_select_public on public.avaliacoes;
create policy avaliacoes_select_public on public.avaliacoes for select to anon, authenticated
  using (status = 'aprovado' or usuario_id = (select auth.uid()) or internal.tem_vinculo(pagina_id));

create or replace function internal.avaliacao_nasce_pendente()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user <> 'area04_backend' then
    new.status := 'pendente';
    new.moderado_em := null;
    new.motivo_moderacao := null;
  end if;
  return new;
end;
$$;

create trigger trg_avaliacao_nasce_pendente
  before insert on public.avaliacoes
  for each row execute function internal.avaliacao_nasce_pendente();
