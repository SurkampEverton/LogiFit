import { safeFetch } from '@repo/security'
/**
 * GET /api/cep/{cep} — proxy auto-fill de endereço via ViaCEP.
 *
 * Caller: form `/app/pessoas/new` (e equivalentes futuros) dispara fetch
 * quando o operador completa 8 dígitos no campo CEP. Devolve os campos
 * canônicos do `persons.address` jsonb (logradouro/bairro/cidade/uf/complemento).
 *
 * Provider: ViaCEP (gratuito, sem chave, mantido pela Prefeitura SP via API
 * pública). Sem cache server-side no MVP — ViaCEP já tem cache CDN agressivo.
 * Se virar gargalo, embrulha em `@repo/cep` análogo a `@repo/cnpj`.
 *
 * Regra 37: fetch externo via `safeFetch` com `allowedHosts` estrita.
 */
import { NextResponse } from 'next/server'
import { getServerSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface ViaCepRaw {
  cep?: string
  logradouro?: string
  complemento?: string
  bairro?: string
  localidade?: string
  uf?: string
  erro?: boolean | string
}

export async function GET(_request: Request, { params }: { params: Promise<{ cep: string }> }) {
  const session = await getServerSession()
  if (!session) {
    return NextResponse.json(
      { ok: false, error: { code: 'UNAUTHORIZED', message: 'sessão expirada' } },
      { status: 401 },
    )
  }

  const { cep: cepRaw } = await params
  const digits = cepRaw.replace(/\D/g, '')
  if (digits.length !== 8) {
    return NextResponse.json(
      { ok: false, error: { code: 'CEP_INVALID', message: 'CEP deve ter 8 dígitos' } },
      { status: 400 },
    )
  }

  try {
    const res = await safeFetch(`https://viacep.com.br/ws/${digits}/json/`, {
      allowedHosts: ['viacep.com.br'],
      timeoutMs: 5000,
    })
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: { code: 'CEP_PROVIDER_DOWN', message: 'ViaCEP indisponível' },
        },
        { status: 502 },
      )
    }
    const raw = (await res.json()) as ViaCepRaw
    // ViaCEP devolve `{ erro: true }` (ou `"true"`) quando CEP inválido/inexistente.
    if (raw.erro === true || raw.erro === 'true') {
      return NextResponse.json(
        { ok: false, error: { code: 'CEP_NOT_FOUND', message: 'CEP não encontrado' } },
        { status: 404 },
      )
    }
    return NextResponse.json({
      ok: true,
      data: {
        cep: digits,
        logradouro: raw.logradouro ?? null,
        complemento: raw.complemento ?? null,
        bairro: raw.bairro ?? null,
        cidade: raw.localidade ?? null,
        uf: raw.uf ?? null,
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'CEP_PROVIDER_ERROR',
          message: err instanceof Error ? err.message : 'erro ao consultar CEP',
        },
      },
      { status: 502 },
    )
  }
}
