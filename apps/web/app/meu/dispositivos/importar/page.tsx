/**
 * /meu/dispositivos/importar — upload CSV InBody. Sprint 32 Faixa C.
 *
 * MVP: textarea com paste do CSV. Sprint 32b: drag-drop + scanUpload regra 38.
 */
import Link from 'next/link'
import { requireMemberOrPassport } from '../../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../../_components/passport-needs-link'
import { ImportCsvForm } from './form'

export const dynamic = 'force-dynamic'

export default async function ImportarPage() {
  const __ctx = await requireMemberOrPassport('/meu/dispositivos/importar')
  if (__ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="importação de dispositivos" />
  }

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Importar arquivo</h1>
        <p className="ev-portal-muted">
          Cole o conteúdo do seu CSV de bioimpedância (InBody, balança Omron exportada, etc.).
          O sistema valida e ingere as leituras automaticamente. Drag-drop e suporte a FIT
          (Garmin) entram em versão futura.
        </p>
      </header>

      <ImportCsvForm />

      <Link href="/meu/dispositivos" className="ev-portal-button ev-portal-button--ghost">
        ← Voltar
      </Link>
    </div>
  )
}
