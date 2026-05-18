/**
 * GET /api/i/[token] — resolve invite-link e retorna metadata (Sprint 02 fechamento).
 *
 * MVP: token = `patient_company_links.id` (UUID). Sprint 02b refina pra
 * token opaco criptografado anti-fraude (encrypt/decrypt com chave server-side).
 *
 * Endpoint público (sem auth) — landing /i/[token] consome pra mostrar:
 *   - Nome do tenant emissor
 *   - Quem enviou (profissional)
 *   - Módulos pedidos
 *   - Status (pending/expired/already_accepted)
 *
 * **Não expõe dados sensíveis** do paciente — só metadata do invite.
 * Paciente confirma identidade fazendo login/cadastro depois.
 */

import { db } from '@repo/db/client'
import {
  patientCompanyLinks,
  patientLinkModules,
  persons,
  tenants,
  users,
} from '@repo/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ token: string }>
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { token } = await params

  if (!UUID_REGEX.test(token)) {
    return NextResponse.json(
      { error: { code: 'INVALID_TOKEN', message: 'Token inválido' } },
      { status: 400 },
    )
  }

  // Busca link + tenant + invitedBy + modules sem RLS (endpoint público —
  // retorna apenas metadata, não dados sensíveis)
  const [link] = await db
    .select({
      id: patientCompanyLinks.id,
      status: patientCompanyLinks.status,
      creationPath: patientCompanyLinks.creationPath,
      invitedAt: patientCompanyLinks.invitedAt,
      acceptedAt: patientCompanyLinks.acceptedAt,
      revokedAt: patientCompanyLinks.revokedAt,
      tenantId: patientCompanyLinks.tenantId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      personMaskedName: persons.name,
      invitedByUserId: patientCompanyLinks.invitedByUserId,
    })
    .from(patientCompanyLinks)
    .innerJoin(tenants, eq(tenants.id, patientCompanyLinks.tenantId))
    .innerJoin(persons, eq(persons.id, patientCompanyLinks.personId))
    .where(eq(patientCompanyLinks.id, token))
    .limit(1)

  if (!link) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Invite não encontrado' } },
      { status: 404 },
    )
  }

  // Resolve quem mandou (profissional) — usa person.name JOIN com users
  let invitedByName: string | null = null
  if (link.invitedByUserId) {
    const [pro] = await db
      .select({ name: persons.name })
      .from(users)
      .innerJoin(persons, eq(persons.id, users.personId))
      .where(eq(users.id, link.invitedByUserId))
      .limit(1)
    invitedByName = pro?.name ?? null
  }

  const modules = await db
    .select({
      module: patientLinkModules.module,
      status: patientLinkModules.status,
      dataLevels: patientLinkModules.dataLevels,
    })
    .from(patientLinkModules)
    .where(
      and(
        eq(patientLinkModules.linkId, link.id),
      ),
    )

  // Mascarar nome (regra anti-fraude — só primeiro nome + iniciais)
  const maskedName = maskName(link.personMaskedName)

  // Status amigável
  const userFacingStatus =
    link.status === 'pending'
      ? 'pending'
      : link.status === 'active'
        ? 'already_accepted'
        : link.revokedAt
          ? 'revoked'
          : 'unknown'

  return NextResponse.json({
    ok: true,
    invite: {
      token: link.id,
      status: userFacingStatus,
      tenantName: link.tenantName,
      tenantSlug: link.tenantSlug,
      invitedByName,
      invitedAt: link.invitedAt,
      acceptedAt: link.acceptedAt,
      personMaskedName: maskedName,
      modules: modules.map((m) => ({
        module: m.module,
        status: m.status,
        dataLevels: m.dataLevels,
      })),
    },
  })
}

function maskName(fullName: string): string {
  if (!fullName) return '—'
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!
  const first = parts[0]!
  const initials = parts.slice(1).map((p) => `${p[0] ?? ''}.`)
  return `${first} ${initials.join(' ')}`
}
