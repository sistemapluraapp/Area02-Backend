// Textos longos chegam do EditorRico como HTML. O limite de caracteres vale
// para o texto visível (sem tags); o HTML bruto tem um teto de 4x o limite.
// A higienização do HTML é feita por quem exibe (componente TextoRico).

export const FATOR_HTML = 4

export function tamanhoTexto(valor: string): number {
  return valor
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|lt|gt|quot|amp|#39);/g, ' ')
    .length
}

export function validarTextoRico(campo: string, texto: string, limite: number): string | null {
  if (tamanhoTexto(texto) > limite) return `${campo} deve ter no máximo ${limite} caracteres`
  if (texto.length > limite * FATOR_HTML) return `${campo} tem formatação demais; simplifique o texto`
  return null
}
