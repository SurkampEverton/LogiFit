/**
 * /meu/agenda/novo — agendar novo. Sprint 26 Faixa C (26b).
 *
 * MVP: lista slots disponíveis nos próximos 7 dias para os instrutores/salas
 * do tenant. Stub funcional — `bookMyAppointment` Server Action vai entrar em
 * Sprint 26c quando reusar `createAppointment` de Sprint 03 com `actor='member'`.
 *
 * Por enquanto: tela informativa apontando paciente pra contato direto (whatsapp).
 * Quando expandir, reusar `expandRecurring(range)` + slot picker.
 */
import Link from 'next/link'
import { requireMemberOrPassport } from '../../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../../_components/passport-needs-link'

export const dynamic = 'force-dynamic'

export default async function NovoAgendamentoPage() {
  const __ctx = await requireMemberOrPassport('/meu/agenda/novo')
  if (__ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="agendamento novo" />
  }

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Agendar novo</h1>
        <p className="ev-portal-muted">Selecione modalidade, profissional e horário disponível.</p>
      </header>

      <div className="ev-portal-callout">
        <h2 className="ev-portal-h2">Agendamento online em breve</h2>
        <p>
          A escolha de horários direto pelo portal está sendo finalizada. Por enquanto, fale com a
          recepção pelo WhatsApp ou ligue para a sua unidade. Após o agendamento, ele aparecerá
          automaticamente na sua agenda.
        </p>
      </div>

      <Link href="/meu/agenda" className="ev-portal-button ev-portal-button--ghost">
        Voltar para agenda
      </Link>
    </div>
  )
}
