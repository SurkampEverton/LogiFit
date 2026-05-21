/**
 * `/app/passport/invites/new` — formulário de criação de invite cross-tenant (Sprint 02b8).
 *
 * Staff escolhe paciente + módulo clínico + profissional responsável → cria
 * invite via `sendPatientInviteSimple` → vê 3 canais de envio resultantes
 * (email auto + WhatsApp staff-shared + copy link manual).
 *
 * Lista de pacientes: members ativos do tenant.
 * Lista de profissionais: users do tenant com role profissional (qualquer
 * registro no `professional_registrations` — academia/fisio/nutri/etc).
 *
 * Sprint 02b9+: select com autocomplete, multi-módulo (1 invite → N modules),
 * preview da mensagem WhatsApp, branding tenant aplicado no preview.
 */
import Link from 'next/link'
import { pool } from '@repo/db/client'
import { requireFullSession } from '../../../../lib/session'
import { NewInviteForm } from './new-invite-form'

export const dynamic = 'force-dynamic'

interface PatientOption {
  personId: string
  name: string
  email: string | null
  phone: string | null
  document: string | null
}

interface ProfessionalOption {
  userId: string
  name: string
  role: string
}

export default async function NewPassportInvitePage() {
  const session = await requireFullSession('/app/passport/invites/new')

  const client = await pool.connect()
  let patients: PatientOption[] = []
  let professionals: ProfessionalOption[] = []
  try {
    await client.query("SELECT set_config('app.tenant_id', $1, false)", [
      session.logifit.tenantId,
    ])

    // Pacientes do tenant (members ativos com person)
    const pRes = await client.query<PatientOption>(
      `SELECT
         p.id AS "personId",
         p.name,
         p.email,
         p.phone,
         p.document
       FROM members m
       INNER JOIN persons p ON p.id = m.person_id
       WHERE m.tenant_id = $1 AND m.archived_at IS NULL
       ORDER BY p.name
       LIMIT 200`,
      [session.logifit.tenantId],
    )
    patients = pRes.rows

    // Profissionais do tenant (users com pelo menos 1 user_role ativo
    // — gate fino por role.kind=professional fica Sprint 02b9)
    const profRes = await client.query<ProfessionalOption>(
      `SELECT DISTINCT
         u.id AS "userId",
         COALESCE(p.name, u.email) AS name,
         r.key AS role
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = $1
       INNER JOIN roles r ON r.id = ur.role_id
       LEFT JOIN persons p ON p.id = u.person_id
       WHERE r.key IN ('medico', 'fisio', 'nutri', 'personal', 'enfermeiro', 'instrutor')
       ORDER BY name
       LIMIT 100`,
      [session.logifit.tenantId],
    )
    professionals = profRes.rows
  } finally {
    await client.query("SELECT set_config('app.tenant_id', '', false)").catch(() => {})
    client.release()
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <nav className="text-sm" style={{ color: 'var(--ev-text-muted)' }}>
          <Link href="/app/passport" style={{ color: 'inherit' }}>
            Passaporte
          </Link>
          {' / '}
          <span>Novo convite</span>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">Convidar paciente</h1>
        <p style={{ color: 'var(--ev-text-muted)' }}>
          Crie um convite pra vincular paciente da sua clínica/academia ao módulo
          clínico desejado. O paciente recebe email automático (se cadastrado) e
          você pode também enviar via WhatsApp direto.
        </p>
      </header>

      <NewInviteForm patients={patients} professionals={professionals} />
    </main>
  )
}
