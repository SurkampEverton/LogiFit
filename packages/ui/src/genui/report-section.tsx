/**
 * <ReportSection /> — Generative UI Sprint 28.
 *
 * Bloco de texto formatado (title + body markdown leve) + tom colorido. Usado
 * pra estruturar relatórios em seções (anamnese, plano, observações).
 *
 * **Markdown leve permitido**: `**bold**`, `*italic*`, listas `- item`. Sem
 * HTML arbitrário — sanitização básica via regex (Sprint 28b: usa
 * `remark-parse` + sanitização).
 */
import type { ReactNode } from 'react'

export interface ReportSectionProps {
  title: string
  body: string
  tone?: 'info' | 'success' | 'warning' | 'danger'
}

const TONE_BORDER: Record<NonNullable<ReportSectionProps['tone']>, string> = {
  info: 'var(--ev-primary)',
  success: 'var(--ev-success)',
  warning: 'var(--ev-warning)',
  danger: 'var(--ev-danger)',
}

const TONE_BG: Record<NonNullable<ReportSectionProps['tone']>, string> = {
  info: 'var(--ev-primary-soft)',
  success: 'var(--ev-success-soft)',
  warning: 'var(--ev-warning-soft)',
  danger: 'var(--ev-danger-soft)',
}

/**
 * Mini-renderer markdown leve. Quebra em parágrafos por linha em branco;
 * dentro do parágrafo, converte `**x**` → <strong>, `*x*` → <em>, e linhas
 * que começam com `- ` viram lista.
 *
 * **Não suporta** links, HTML, imagens, headers. Sprint 28b refina.
 */
function renderMarkdownLight(body: string): ReactNode[] {
  const blocks = body.split(/\n\s*\n/)
  const out: ReactNode[] = []
  for (const [bi, block] of blocks.entries()) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    const isList = lines.every((l) => /^\s*-\s+/.test(l))
    if (isList && lines.length > 0) {
      out.push(
        <ul key={`b${bi}`} style={{ margin: '0 0 var(--ev-space-2) 1.25rem' }}>
          {lines.map((l, i) => (
            <li key={i}>{renderInline(l.replace(/^\s*-\s+/, ''))}</li>
          ))}
        </ul>,
      )
    } else {
      out.push(
        <p key={`b${bi}`} style={{ margin: '0 0 var(--ev-space-2) 0' }}>
          {renderInline(block.replace(/\n/g, ' '))}
        </p>,
      )
    }
  }
  return out
}

function renderInline(text: string): ReactNode[] {
  // Split por padrão alternado: **bold** / *italic* / texto literal
  const parts: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      parts.push(<strong key={`i${idx++}`}>{token.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={`i${idx++}`}>{token.slice(1, -1)}</em>)
    }
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function ReportSection(props: ReportSectionProps): ReactNode {
  const tone = props.tone ?? 'info'
  return (
    <section
      style={{
        padding: 'var(--ev-space-4)',
        borderLeft: `4px solid ${TONE_BORDER[tone]}`,
        backgroundColor: TONE_BG[tone],
        borderRadius: '0 var(--ev-radius-md) var(--ev-radius-md) 0',
      }}
    >
      <h3
        style={{
          margin: '0 0 var(--ev-space-2) 0',
          fontSize: 'var(--ev-text-base)',
          color: 'var(--ev-text)',
        }}
      >
        {props.title}
      </h3>
      <div style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text)' }}>
        {renderMarkdownLight(props.body)}
      </div>
    </section>
  )
}
