/**
 * /meu/dispositivos/importar — upload CSV InBody. Sprint 32 Faixa C.
 *
 * MVP: textarea com paste do CSV. Sprint 32b: drag-drop + scanUpload regra 38.
 */
import Link from 'next/link'
import { requireMemberSession } from '../../../lib/member-session'
import { ImportCsvForm } from './form'

export const dynamic = 'force-dynamic'

export default async function ImportarPage() {
  await requireMemberSession('/meu/dispositivos/importar')

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
