-- =============================================================================
-- Acessibilidade para pessoas cegas e surdas na página do empreendimento.
-- Aplicada no Supabase grupo01-useast2 (uoembacxxnkuwldmdgcu). Aditiva.
-- =============================================================================

-- "Como é o lugar": descrição do percurso e do ambiente, em ordem, pensada
-- para quem não enxerga (entrada, piso, obstáculos, onde fica cada coisa).
alter table public.paginas
  add column como_e_o_lugar text check (char_length(como_e_o_lugar) <= 2000);

-- "Apresentação em Libras": link de vídeo (YouTube) com intérprete.
alter table public.paginas
  add column video_libras text check (char_length(video_libras) <= 500 and video_libras ~ '^https://');

comment on column public.paginas.como_e_o_lugar is 'Descrição do ambiente e do percurso para pessoas cegas ou com baixa visão (até 2000 caracteres).';
comment on column public.paginas.video_libras is 'Link do YouTube com a apresentação do lugar em Libras.';
