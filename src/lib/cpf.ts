export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}
