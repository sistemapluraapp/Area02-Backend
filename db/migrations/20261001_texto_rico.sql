-- Editor rico: textos longos passam a ser salvos como HTML.
-- O limite de caracteres visíveis (2000) é validado pelo backend; aqui fica
-- só um teto para o HTML bruto (até 4x o texto visível).
alter table public.paginas drop constraint if exists paginas_como_e_o_lugar_check;
alter table public.paginas
  add constraint paginas_como_e_o_lugar_check check (char_length(como_e_o_lugar) <= 8000);
