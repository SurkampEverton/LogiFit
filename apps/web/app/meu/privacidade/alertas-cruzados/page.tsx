/**
 * /meu/privacidade/alertas-cruzados — alertas cross-prescription. Sprint 26 Faixa C (26b).
 *
 * Lista alertas envolvendo o paciente (Sprint 11 emite `cross_prescription_alerts`
 * quando detectar conflitos: ex. fisio prescreveu repouso e personal manteve treino
 * pesado mesmo dia). Tabela `cross_prescription_alerts` planejada Sprint 11+ ainda
 * não materializada — esta página é stub formal que renderiza vazio com explicação.
 *
 * Sprint 26c: quando schema existir, agregar via passport_passport_id e mostrar:
 *   - Data + tipo de conflito + descrição + profissionais envolvidos
 *   - Botão "marcar como lido" → `acknowledgeCrossPrescriptionAlert`
 */
import Link from 'next/link'
import { requireMemberSession } from '../../../lib/member-session'

export const dynamic = 'force-dynamic'

export default async function AlertasCruzadosPage() {
  await requireMemberSession('/meu/privacidade/alertas-cruzados')

  // Schema `cross_prescription_alerts` será criado em Sprint 11+ extensão.
  // MVP: stub explicativo. Quando tabela existir, listar com filtros.
  const alerts: Array<{ id: string; created_at: Date; title: string; detail: string }> = []

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Alertas cruzados</h1>
        <p className="ev-portal-muted">
          Quando diferentes profissionais (fisio + personal + nutri) prescrevem coisas que
          podem entrar em conflito, geramos um alerta. Você vê aqui o histórico completo +
          justificativa do profissional se prosseguiu mesmo assim.
        </p>
      </header>

      {alerts.length === 0 ? (
        <div className="ev-portal-empty">
          Você não tem alertas cruzados no momento.
          <br />
          Esta tela é atualizada automaticamente quando algum profissional registra
          algo conflitante.
        </div>
      ) : (
        <ol className="ev-portal-timeline">
          {alerts.map((a) => (
            <li key={a.id} className="ev-portal-timeline-item">
              <div className="ev-portal-h3">{a.title}</div>
              <div className="ev-portal-muted">{a.created_at.toLocaleString('pt-BR')}</div>
              <p>{a.detail}</p>
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
