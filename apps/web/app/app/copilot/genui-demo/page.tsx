/**
 * `/app/copilot/genui-demo` — Sprint 28 Faixa D.
 *
 * Demo da Generative UI: prompt input + render dos blocos retornados.
 * Roda em Server Component (form), submit via Server Action.
 *
 * Sugestões de teste:
 *   - "resumo do Marcelo" → patient card + report section
 *   - "evolução da dor lombar" → evolution chart
 *   - "CIDs prováveis pra lombalgia" → cid suggestion
 *   - "exercícios pra reabilitação lombar" → exercise recommendation
 *   - "comparação antes/depois" → measurement comparison
 *   - "relatório completo" → tudo junto
 */
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'
import { GenUIDemoForm } from './form'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

export default async function GenUIDemoPage({ searchParams }: PageProps) {
  await requireFullSession('/app/copilot/genui-demo')
  const { q } = await searchParams

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Generative UI · Demo</h1>
        <span style={{ color: 'var(--ev-text-muted)' }}>Sprint 28 · ADR 0085 — fecha Fase 2</span>
      </header>

      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, color: 'var(--ev-text-muted)' }}>
          Pergunte algo clínico. A resposta vai vir{' '}
          <strong>misturando texto e componentes ricos</strong> (card de paciente, gráfico de
          evolução, sugestão de CID, recomendação de exercícios, comparação de medições, blocos de
          relatório).
        </p>
        <p style={{ color: 'var(--ev-text-muted)' }}>
          Exemplos prontos:{' '}
          <Link href="?q=resumo+do+Marcelo+com+evolu%C3%A7%C3%A3o+da+dor+e+exerc%C3%ADcios">
            resumo + evolução + exercícios
          </Link>
          {' · '}
          <Link href="?q=CIDs+prov%C3%A1veis+para+lombalgia">CIDs lombalgia</Link>
          {' · '}
          <Link href="?q=compara%C3%A7%C3%A3o+antes+e+depois">comparação antes/depois</Link>
          {' · '}
          <Link href="?q=relat%C3%B3rio+completo+do+paciente">relatório completo</Link>
        </p>
      </section>

      <GenUIDemoForm initialPrompt={q ?? ''} />
    </div>
  )
}
