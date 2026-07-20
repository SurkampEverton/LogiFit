/**
 * /meu/diario/novo — formulário de registro de refeição. Sprint 31 Faixa C.
 *
 * MVP: textarea livre + meal name + horário. Picker de foods + foto vem
 * Sprint 31b (depende component package autocomplete + scanUpload).
 */
import Link from 'next/link'
import { requireMemberOrPassport } from '../../../lib/require-member-or-passport'
import { PassportNeedsLink } from '../../_components/passport-needs-link'
import { NewDiaryForm } from './form'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ meal?: string }>
}

export default async function NovoDiaryPage({ searchParams }: PageProps) {
  const __ctx = await requireMemberOrPassport('/meu/diario/novo')
  if (__ctx.kind === 'passport_needs_link') {
    return <PassportNeedsLink feature="registrar refeição" />
  }
  const { meal } = await searchParams

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Registrar refeição</h1>
        <p className="ev-portal-muted">
          Registre o que comeu — pode ser texto livre ou selecionando alimentos do catálogo. O nutri
          vai revisar e comentar.
        </p>
      </header>

      <NewDiaryForm initialMeal={meal ?? null} />

      <Link href="/meu/diario" className="ev-portal-button ev-portal-button--ghost">
        ← Voltar
      </Link>
    </div>
  )
}
