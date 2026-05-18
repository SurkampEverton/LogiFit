/**
 * /i/[token] — landing page do invite de passaporte cross-tenant (Sprint 02 fechamento).
 *
 * MVP: busca metadata via `GET /api/i/[token]` e mostra:
 *   - Nome do tenant emissor + profissional
 *   - Módulos pedidos (academia/fisio/nutri/personal/pilates)
 *   - Status amigável (pending → CTA login/cadastro; already_accepted → "já aceitou";
 *     revoked → "convite revogado")
 *
 * Path A reativo: paciente clica → branch automático (CPF existe → login;
 * CPF novo → cadastro path B Sprint 02b). MVP: link "Fazer login" + "Cadastrar
 * minha conta" placeholder pra Sprint 02b ativar Path B.
 *
 * Não expõe dados sensíveis — só metadata. Aceite/recusa acontece após login.
 */
import Link from 'next/link'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

const MODULE_LABEL: Record<string, { icon: string; label: string; description: string }> = {
  academia: { icon: '🏋️', label: 'Academia', description: 'Frequência + treinos + avaliações' },
  personal_training: {
    icon: '🥇',
    label: 'Personal trainer',
    description: 'Treinos individualizados + acompanhamento',
  },
  fisioterapia: {
    icon: '🩺',
    label: 'Fisioterapia',
    description: 'Prontuário clínico + evoluções + CID/CIF',
  },
  nutricao: {
    icon: '🥗',
    label: 'Nutrição',
    description: 'Plano alimentar + diário + exames laboratoriais',
  },
  pilates: { icon: '🧘', label: 'Pilates', description: 'Sessões + evoluções' },
}

interface InviteResponse {
  ok: true
  invite: {
    token: string
    status: 'pending' | 'already_accepted' | 'revoked' | 'unknown'
    tenantName: string
    tenantSlug: string
    invitedByName: string | null
    invitedAt: string | null
    acceptedAt: string | null
    personMaskedName: string
    modules: Array<{
      module: string
      status: string
      dataLevels: {
        identidade?: boolean
        antropometria?: boolean
        treino?: boolean
        clinico?: boolean
      } | null
    }>
  }
}

interface InviteError {
  error: { code: string; message: string }
}

async function resolveInvite(token: string): Promise<InviteResponse | InviteError> {
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  const url = `${proto}://${host}/api/i/${encodeURIComponent(token)}`
  const r = await fetch(url, { cache: 'no-store' })
  return (await r.json()) as InviteResponse | InviteError
}

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function InviteLandingPage({ params }: PageProps) {
  const { token } = await params
  const result = await resolveInvite(token)

  if ('error' in result) {
    return (
      <div className="ev-portal-page" style={{ padding: 'var(--ev-space-lg)' }}>
        <h1 className="ev-portal-h1">Convite não encontrado</h1>
        <p className="ev-portal-muted">
          O link que você abriu não é válido ou expirou. Confirme com a empresa que enviou.
        </p>
        <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
          Código: <code>{result.error.code}</code>
        </p>
      </div>
    )
  }

  const { invite } = result
  const dataLevelsRequested = aggregateDataLevels(invite.modules)

  return (
    <div className="ev-portal-page" style={{ padding: 'var(--ev-space-lg)', maxWidth: 640 }}>
      <header style={{ marginBottom: 'var(--ev-space-lg)' }}>
        <h1 className="ev-portal-h1" style={{ marginBottom: 'var(--ev-space-2)' }}>
          Convite de {invite.tenantName}
        </h1>
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          {invite.invitedByName ? `Enviado por ${invite.invitedByName}` : 'Empresa cadastrada na LogiFit'}
          {invite.invitedAt ? ` · ${new Date(invite.invitedAt).toLocaleDateString('pt-BR')}` : ''}
        </p>
      </header>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)', marginBottom: 'var(--ev-space-md)' }}>
        <p>
          Olá, <strong>{invite.personMaskedName}</strong>. A empresa <strong>{invite.tenantName}</strong>{' '}
          quer se conectar ao seu passaporte na LogiFit para acompanhar:
        </p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 'var(--ev-space-2)' }}>
          {invite.modules.map((m) => {
            const meta = MODULE_LABEL[m.module]
            if (!meta) return null
            return (
              <li
                key={m.module}
                style={{
                  padding: 'var(--ev-space-2)',
                  borderLeft: '3px solid var(--ev-primary)',
                  marginBottom: 'var(--ev-space-2)',
                  background: 'var(--ev-surface-muted)',
                  borderRadius: 'var(--ev-radius-sm)',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {meta.icon} {meta.label}
                </div>
                <small style={{ color: 'var(--ev-text-muted)' }}>{meta.description}</small>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)', marginBottom: 'var(--ev-space-md)' }}>
        <h3 style={{ marginTop: 0 }}>Dados que serão compartilhados:</h3>
        <ul>
          {dataLevelsRequested.identidade && <li>📇 Identidade (nome, contato)</li>}
          {dataLevelsRequested.antropometria && <li>📏 Antropometria (peso, altura, %BF)</li>}
          {dataLevelsRequested.treino && <li>💪 Treino (workout, frequência, RPE)</li>}
          {dataLevelsRequested.clinico && <li>🩺 Clínico (sintomas, restrições, CIDs — apenas resumo)</li>}
        </ul>
        <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
          Notas privadas do profissional, dados financeiros e prontuário CFM original{' '}
          <strong>nunca cruzam empresas</strong>. Você pode revogar este vínculo a qualquer momento em{' '}
          <code>/meu/privacidade</code>.
        </p>
      </section>

      {invite.status === 'pending' ? (
        <section style={{ textAlign: 'center', marginTop: 'var(--ev-space-lg)' }}>
          <p style={{ marginBottom: 'var(--ev-space-md)' }}>
            Para aceitar (parcial ou total), entre na sua conta ou crie uma:
          </p>
          <div style={{ display: 'grid', gap: 'var(--ev-space-2)' }}>
            <Link
              href={`/meu/login?next=${encodeURIComponent(`/i/${invite.token}/aceitar`)}`}
              className="ev-portal-button"
            >
              Fazer login na minha conta
            </Link>
            <Link
              href={`/cadastro?invite=${encodeURIComponent(invite.token)}`}
              className="ev-portal-button ev-portal-button--ghost"
            >
              Criar minha conta LogiFit
            </Link>
          </div>
          <p style={{ marginTop: 'var(--ev-space-md)', fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Cadastro proativo (`/cadastro`) entra em Sprint 02b — depende provisionamento Twilio SMS + Cloudflare Turnstile.
          </p>
        </section>
      ) : invite.status === 'already_accepted' ? (
        <section
          className="ev-card"
          style={{
            padding: 'var(--ev-space-md)',
            borderLeft: '4px solid var(--ev-success)',
            background: 'var(--ev-success-soft, var(--ev-surface-muted))',
          }}
        >
          <h3 style={{ marginTop: 0 }}>✓ Convite já aceito</h3>
          <p>
            Você já aceitou este convite{' '}
            {invite.acceptedAt ? `em ${new Date(invite.acceptedAt).toLocaleDateString('pt-BR')}` : ''}.
          </p>
          <Link href="/meu/privacidade" className="ev-portal-button">
            Ver minhas conexões
          </Link>
        </section>
      ) : (
        <section
          className="ev-card"
          style={{
            padding: 'var(--ev-space-md)',
            borderLeft: '4px solid var(--ev-danger)',
            background: 'var(--ev-danger-soft, var(--ev-surface-muted))',
          }}
        >
          <h3 style={{ marginTop: 0 }}>Convite indisponível</h3>
          <p>
            Este convite foi revogado pela empresa ou expirou. Entre em contato com{' '}
            {invite.tenantName} para um novo.
          </p>
        </section>
      )}
    </div>
  )
}

interface DataLevelsAggregate {
  identidade: boolean
  antropometria: boolean
  treino: boolean
  clinico: boolean
}

function aggregateDataLevels(
  modules: InviteResponse['invite']['modules'],
): DataLevelsAggregate {
  const seed: DataLevelsAggregate = {
    identidade: false,
    antropometria: false,
    treino: false,
    clinico: false,
  }
  return modules.reduce<DataLevelsAggregate>((acc, m) => {
    const l = m.dataLevels ?? {}
    return {
      identidade: acc.identidade || !!l.identidade,
      antropometria: acc.antropometria || !!l.antropometria,
      treino: acc.treino || !!l.treino,
      clinico: acc.clinico || !!l.clinico,
    }
  }, seed)
}
