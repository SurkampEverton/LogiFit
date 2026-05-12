import { db } from '@repo/db/client'
import { members } from '@repo/db/schema'
import { and, count, eq, isNull } from 'drizzle-orm'
/**
 * `/app` — landing autenticada (Sprint 00b Faixa A).
 *
 * Sprint 07 vai reescrever esta página pro **Dashboard "Equilíbrio Vital"**
 * completo com widgets cross-module, alertas, KPIs por persona. Aqui é só
 * um shell pra existir uma rota de destino pós-login com cards de atalho
 * para áreas funcionais já entregues.
 *
 * Cards estáticos (não consultam DB) — preservam <1s LCP enquanto Sprint 07
 * não chega.
 */
import Link from 'next/link'
import { requireFullSession } from '../lib/session'

export const dynamic = 'force-dynamic'

interface DashCardProps {
  href: string
  emoji: string
  title: string
  desc: string
  badge?: string
}

function DashCard({ href, emoji, title, desc, badge }: DashCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-[color:var(--ev-border)] p-5 transition-colors hover:bg-[color:var(--ev-surface)]"
      style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-2xl">{emoji}</div>
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-[color:var(--ev-text-muted)]">{desc}</div>
        </div>
        {badge && (
          <span className="rounded-full bg-[color:var(--ev-primary)] px-2 py-0.5 text-xs text-[color:var(--ev-primary-foreground)]">
            {badge}
          </span>
        )}
      </div>
    </Link>
  )
}

export default async function AppHomePage() {
  const session = await requireFullSession('/app')
  const claims = session.logifit

  // Contagem de members ativos (não-arquivados) — single COUNT, leve
  const [memberCount] = await db
    .select({ n: count() })
    .from(members)
    .where(and(eq(members.tenantId, claims.tenantId), isNull(members.archivedAt)))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Bem-vindo ao LogiFit</h1>
        <p className="text-[color:var(--ev-text-muted)]">
          Sprint 07 vai trazer o dashboard completo (KPIs, alertas cross-module, widgets por
          persona). Por enquanto, atalhos para o que já está aterrissado.
        </p>
      </header>

      <section
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}
      >
        <DashCard
          href="/app/members"
          emoji="👥"
          title="Alunos / Pacientes"
          desc="CRM unificado — Sprint 02"
          badge={`${memberCount?.n ?? 0}`}
        />
        <DashCard
          href="/app/pessoas"
          emoji="📇"
          title="Pessoas (PF/PJ)"
          desc="Cadastro central — Sprint 01a/01b"
        />
        <DashCard
          href="/app/settings/users"
          emoji="⚙️"
          title="Usuários e roles"
          desc="RBAC + permissões — Sprint 01a"
        />
        <DashCard
          href="/seguranca"
          emoji="🔐"
          title="Segurança da conta"
          desc="Senha, MFA, sessões"
        />
        <DashCard
          href="/meu/sessoes"
          emoji="💻"
          title="Minhas sessões"
          desc="Dispositivos ativos"
        />
      </section>

      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm">
        <div className="font-semibold mb-2">Em breve</div>
        <ul className="space-y-1 text-[color:var(--ev-text-muted)] list-disc pl-6">
          <li>📅 Agenda universal (Sprint 03)</li>
          <li>💰 Financeiro Asaas (Sprint 04)</li>
          <li>🤖 Assistente IA (Sprint 06)</li>
          <li>🚪 Controle de acesso Academia (Sprint 08)</li>
          <li>📊 Dashboard "Equilíbrio Vital" completo (Sprint 07)</li>
        </ul>
      </section>
    </div>
  )
}
