export function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

export function isValidCpf(cpf: string): boolean {
  const digits = normalizeCpf(cpf)
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false

  const calcCheckDigit = (base: string): number => {
    let sum = 0
    let weight = base.length + 1
    for (const char of base) {
      sum += Number(char) * weight
      weight -= 1
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  const firstNine = digits.slice(0, 9)
  const digit1 = calcCheckDigit(firstNine)
  const digit2 = calcCheckDigit(firstNine + digit1)

  return digits === firstNine + String(digit1) + String(digit2)
}
