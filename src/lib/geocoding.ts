interface EnderecoParaGeocodificar {
  endereco?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
}

interface Coordenadas {
  latitude: number
  longitude: number
}

// Geocodifica um endereço via Nominatim (OpenStreetMap) — API pública,
// sem necessidade de chave. Respeita a política de uso exigindo um
// User-Agent descritivo. Retorna null em qualquer falha (endereço vazio,
// nada encontrado, API fora do ar) — geocodificação é best-effort e nunca
// deve bloquear a criação/edição do empreendimento.
export async function geocodificarEndereco(dados: EnderecoParaGeocodificar): Promise<Coordenadas | null> {
  const partes = [dados.endereco, dados.cidade, dados.uf, dados.cep, 'Brasil'].filter(Boolean)
  if (partes.length < 2) return null

  const query = partes.join(', ')

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PluraApp/1.0 (contato: sistemapluraapp@gmail.com)' },
    })
    if (!res.ok) return null

    const resultados = await res.json<{ lat: string; lon: string }[]>()
    const primeiro = resultados[0]
    if (!primeiro) return null

    const latitude = Number.parseFloat(primeiro.lat)
    const longitude = Number.parseFloat(primeiro.lon)
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null

    return { latitude, longitude }
  } catch {
    return null
  }
}
