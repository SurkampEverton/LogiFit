/**
 * Seed Sprint 13 — mensagens.
 *
 * Idempotente. Por tenant:
 *   1. Cria 3 templates canônicos (WhatsApp): cobranca_d1, reengajamento_15d,
 *      boas_vindas
 *   2. Cria 1 régua "Cobrança D+1/+3/+7" desativada (ativar via UI quando
 *      templates aprovados)
 *
 * Roda como superuser pra bypassar RLS.
 *
 * Uso: `pnpm --filter @repo/db db:seed:mensagens`
 */
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  messageTemplates,
  reguas,
  tenants,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const TEMPLATES = [
  {
    slug: 'cobranca_d1',
    name: 'Cobrança D+1',
    channel: 'whatsapp' as const,
    body: 'Olá {{member.name}}! Identificamos que sua fatura de {{invoice.amount}} venceu ontem ({{invoice.due_date}}). Pode dar uma olhadinha? Qualquer dúvida estamos aqui.',
  },
  {
    slug: 'cobranca_d3',
    name: 'Cobrança D+3',
    channel: 'whatsapp' as const,
    body: 'Oi {{member.name}}, ainda não recebemos o pagamento da fatura {{invoice.id}} ({{invoice.amount}}). Se precisar de ajuda pra negociar, é só responder esta mensagem.',
  },
  {
    slug: 'cobranca_d7',
    name: 'Cobrança D+7 (email)',
    channel: 'email' as const,
    subject: 'Pendência de pagamento — {{invoice.id}}',
    body: 'Prezado(a) {{member.name}},\n\nIdentificamos que a fatura {{invoice.id}} (valor {{invoice.amount}}) permanece em aberto há 7 dias.\n\nPedimos a gentileza de regularizar para evitar suspensão do contrato.\n\nAtenciosamente,\nEquipe',
  },
  {
    slug: 'reengajamento_15d',
    name: 'Reengajamento 15 dias',
    channel: 'whatsapp' as const,
    body: 'Sentimos sua falta, {{member.name}}! Já faz 15 dias sem te ver por aqui. Posso te ajudar a remarcar uma aula ou tirar alguma dúvida?',
  },
  {
    slug: 'boas_vindas',
    name: 'Boas-vindas',
    channel: 'whatsapp' as const,
    body: 'Olá {{member.name}}! Seja muito bem-vindo(a) à {{company.name}} 💙 Estamos felizes em ter você com a gente. Qualquer coisa, é só chamar!',
  },
]

const COBRANCA_REGUA = {
  name: 'Cobrança D+1 / D+3 / D+7',
  description:
    'Régua de cobrança progressiva via WhatsApp D+1/+3 e email D+7. Pausa automaticamente quando invoice.paid dispara.',
  trigger: { event: 'invoice.overdue', filter: { days_overdue: [1, 3, 7] } },
  actions: [
    { kind: 'send_message', channel: 'whatsapp', template_slug: 'cobranca_d1', delay_days: 0 },
    { kind: 'send_message', channel: 'whatsapp', template_slug: 'cobranca_d3', delay_days: 2 },
    { kind: 'send_message', channel: 'email', template_slug: 'cobranca_d7', delay_days: 4 },
  ],
  stop_on: ['invoice.paid', 'invoice.cancelled'],
  guards: { consent: 'marketing_messages', rate_limit_per_member_24h: 3 },
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding mensagens ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  const tenantsRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  console.log(`  • ${tenantsRows.length} tenants encontrados`)

  for (const tenant of tenantsRows) {
    // Templates
    let templatesInserted = 0
    for (const tpl of TEMPLATES) {
      const variables = Array.from(
        new Set([...tpl.body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!)),
      )
      const initialApproval = tpl.channel === 'email' ? 'approved' : 'draft'
      const res = await db
        .insert(messageTemplates)
        .values({
          tenantId: tenant.id,
          channel: tpl.channel,
          slug: tpl.slug,
          name: tpl.name,
          subject: 'subject' in tpl ? tpl.subject : null,
          body: tpl.body,
          variables,
          approvalStatus: initialApproval,
          approvedAt: initialApproval === 'approved' ? new Date() : null,
        })
        .onConflictDoNothing({
          target: [messageTemplates.tenantId, messageTemplates.slug],
        })
        .returning({ id: messageTemplates.id })
      if (res.length > 0) templatesInserted++
    }

    // Régua
    const existingReguas = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(reguas)
      .where(and(eq(reguas.tenantId, tenant.id), eq(reguas.name, COBRANCA_REGUA.name)))
    if ((existingReguas[0]?.n ?? 0) === 0) {
      await db.insert(reguas).values({
        tenantId: tenant.id,
        name: COBRANCA_REGUA.name,
        description: COBRANCA_REGUA.description,
        trigger: COBRANCA_REGUA.trigger,
        actions: COBRANCA_REGUA.actions,
        stopOn: COBRANCA_REGUA.stop_on,
        guards: COBRANCA_REGUA.guards,
        active: false,
      })
    }

    console.log(
      `  • ${tenant.name}: ${templatesInserted}/${TEMPLATES.length} templates novos + 1 régua "Cobrança"`,
    )
  }

  await pool.end()
  console.log('✓ seed mensagens done')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
