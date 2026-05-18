/**
 * /meu/privacidade/incidentes — incidentes de segurança que afetaram o paciente.
 * Sprint 26 Faixa C (26b) — ADR 0067 addendum cross-tenant.
 *
 * Tabela `security_incidents` planejada via addendum ao ADR 0067; ainda não
 * materializada. Esta página é stub formal: quando schema existir, agregar
 * incidentes cujo `affected_passport_ids` contenha o paciente + mostrar push
 * PWA quando novo incidente (Sprint 26c).
 *
 * Direito do titular (LGPD art. 48 + ANPD Res. 2/2024): notificação em 72h.
 */
import Link from 'next/link'
import { requireMemberSession } from '../../../lib/member-session'

export const dynamic = 'force-dynamic'

export default async function IncidentesPage() {
  await requireMemberSession('/meu/privacidade/incidentes')

  const incidents: Array<{
    id: string
    occurred_at: Date
    severity: 'low' | 'medium' | 'high' | 'critical'
    summary: string
    affected: string
  }> = []

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Incidentes de segurança</h1>
        <p className="ev-portal-muted">
          A LGPD nos obriga (e nós queremos) avisar você em até 72 horas se algum
          incidente envolveu seus dados. Aqui você vê o histórico completo.
        </p>
      </header>

      {incidents.length === 0 ? (
        <div className="ev-portal-callout ev-portal-callout--success">
          <h2 className="ev-portal-h2">Nenhum incidente registrado</h2>
          <p>
            Seus dados nunca foram afetados por incidente em nenhum dos estabelecimentos
            vinculados. Estamos atentos 24/7 — qualquer evento te notifica aqui + por
            email + push do app.
          </p>
        </div>
      ) : (
        <ol className="ev-portal-timeline">
          {incidents.map((i) => (
            <li key={i.id} className="ev-portal-timeline-item">
              <div className="ev-portal-h3">{i.summary}</div>
              <div className="ev-portal-muted">
                {i.occurred_at.toLocaleString('pt-BR')} · severidade {i.severity}
              </div>
              <p>{i.affected}</p>
            </li>
          ))}
        </ol>
      )}

      <Link href="/meu/privacidade" className="ev-portal-button ev-portal-button--ghost">
        Voltar
      </Link>
    </div>
  )
}
