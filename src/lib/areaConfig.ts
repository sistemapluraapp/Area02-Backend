// Diferenças entre as Áreas 02 (B2B) e 03 (B2G) na gestão de páginas.
// Os demais arquivos de src/lib/pagina*.ts e src/routes/{paginas,midias,
// experiencias,opcoes}.ts são idênticos nas duas áreas.
export const AREA_CONFIG = {
  tipoPagina: 'privada',
  escopo: 'b2b',
  colunaCriador: 'criado_por_usuario',
  colunaVinculo: 'usuario_id',
  selectVinculos: 'id, usuario_id, papel, created_at, usuarios(nome)',
} as const
