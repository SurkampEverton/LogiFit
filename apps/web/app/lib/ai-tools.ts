/**
 * Whitelist inicial de tools do assistente (Sprint 06 Faixa C — ADR 0075 +
 * regra 41).
 *
 * Este módulo é o único bootstrap centralizado por enquanto. Sprint 06+ Faixa
 * D distribui pra cada módulo (`apps/web/app/app/<modulo>/ai-tools.ts`) com
 * build hook que importa e sync com `tools_registry` DB.
 *
 * **MVP whitelist** (~9 tools):
 *   - `assistente.searchHelp` (todos) — Camada 1 RAG
 *   - `assistente.report_issue` (todos) — Camada 3 abrir ticket
 *   - `agenda.getMyAppointments` (member) — Camada 2 read
 *   - `agenda.cancelMyAppointment` (member) — Camada 3 confirm
 *   - `financeiro.getMyInvoices` (member) — Camada 2 read
 *   - `financeiro.requestSecondCopy` (member) — Camada 3 confirm
 *   - `members.findMember` (recepcao/admin/clinical/coach) — Camada 2
 *   - `agenda.scheduleAppointmentForMember` (recepcao/admin) — Camada 3
 *   - `financeiro.getOverdueInvoices` (admin) — Camada 2
 *
 * Bloqueio explícito (`// ai-blocked`) ficam em arquivos próprios — por
 * exemplo `signEvolution` no Sprint 20 fisio.
 */
import { registerAITool } from '@repo/ai'

let registered = false

export function registerAllAITools() {
  if (registered) return
  registered = true

  // ─── Camada 1 (Help / RAG) ─────────────────────────────────────────────
  registerAITool({
    key: 'assistente.searchHelp',
    module: 'assistente',
    layer: 'help',
    label: 'Buscar ajuda',
    description: 'Busca conteúdo da documentação LogiFit (ADRs/sprints/manuais) via RAG semântico.',
    showInPersonas: [
      'member',
      'professional_clinical',
      'professional_coach',
      'admin',
      'recepcao',
      'super_admin',
      'contador_externo',
      'dpo',
    ],
    requiresConfirmation: false,
    argsSchemaJson: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 200 } },
      required: ['query'],
    },
  })

  // ─── Camada 3 (Action — tool universal report_issue) ───────────────────
  registerAITool({
    key: 'assistente.report_issue',
    module: 'assistente',
    layer: 'action',
    label: 'Abrir ticket de suporte',
    description:
      'Abre ticket em support_tickets com contexto rico (tool calls, pergunta original, erro).',
    showInPersonas: [
      'member',
      'professional_clinical',
      'professional_coach',
      'admin',
      'recepcao',
      'super_admin',
      'contador_externo',
      'dpo',
    ],
    requiresConfirmation: true,
    argsSchemaJson: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 2, maxLength: 120 },
        description: { type: 'string', minLength: 2, maxLength: 4000 },
        category: {
          type: 'string',
          enum: ['bug', 'question', 'feature_request', 'billing', 'other'],
        },
      },
      required: ['title', 'description'],
    },
  })

  // ─── Member (Camada 2 read) ────────────────────────────────────────────
  registerAITool({
    key: 'agenda.getMyAppointments',
    module: 'agenda',
    layer: 'insight',
    label: 'Minhas aulas',
    description: 'Lista próximas aulas do aluno (member ativo). Filtra por janela de dias.',
    showInPersonas: ['member'],
    requiresConfirmation: false,
    argsSchemaJson: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
      },
    },
  })

  registerAITool({
    key: 'financeiro.getMyInvoices',
    module: 'financeiro',
    layer: 'insight',
    label: 'Minhas mensalidades',
    description: 'Lista mensalidades do aluno com status (pendente/paga/vencida).',
    showInPersonas: ['member'],
    requiresConfirmation: false,
    argsSchemaJson: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'paid', 'overdue', 'all'] } },
    },
  })

  // ─── Member (Camada 3 — confirmação obrigatória) ───────────────────────
  registerAITool({
    key: 'agenda.cancelMyAppointment',
    module: 'agenda',
    layer: 'action',
    label: 'Cancelar minha aula',
    description: 'Cancela aula futura do aluno. Validação: até 1h antes do início.',
    showInPersonas: ['member'],
    requiresConfirmation: true,
    argsSchemaJson: {
      type: 'object',
      properties: { appointmentId: { type: 'string', format: 'uuid' } },
      required: ['appointmentId'],
    },
  })

  registerAITool({
    key: 'financeiro.requestSecondCopy',
    module: 'financeiro',
    layer: 'action',
    label: 'Pedir 2ª via boleto',
    description: 'Solicita 2ª via de boleto para mensalidade pendente. Gera novo link Asaas.',
    showInPersonas: ['member'],
    requiresConfirmation: true,
    argsSchemaJson: {
      type: 'object',
      properties: { invoiceId: { type: 'string', format: 'uuid' } },
      required: ['invoiceId'],
    },
  })

  // ─── Recepcao/Admin (Camada 2 read) ───────────────────────────────────
  registerAITool({
    key: 'members.findMember',
    module: 'members',
    layer: 'insight',
    label: 'Buscar aluno/paciente',
    description: 'Busca member por nome ou CPF. Retorna id + nome + contato mascarado.',
    showInPersonas: ['recepcao', 'admin', 'professional_clinical', 'professional_coach'],
    requiredPermissions: ['members.read'],
    requiresConfirmation: false,
    argsSchemaJson: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 2, maxLength: 80 } },
      required: ['query'],
    },
  })

  // ─── Recepcao/Admin (Camada 3 — confirmação) ──────────────────────────
  registerAITool({
    key: 'agenda.scheduleAppointmentForMember',
    module: 'agenda',
    layer: 'action',
    label: 'Marcar aula para aluno',
    description: 'Marca aula em horário específico. Verifica conflitos + capacidade.',
    showInPersonas: ['recepcao', 'admin'],
    requiredPermissions: ['agenda.write'],
    requiresConfirmation: true,
    argsSchemaJson: {
      type: 'object',
      properties: {
        memberId: { type: 'string', format: 'uuid' },
        resourceId: { type: 'string', format: 'uuid' },
        startsAt: { type: 'string', format: 'date-time' },
      },
      required: ['memberId', 'resourceId', 'startsAt'],
    },
  })

  // ─── Admin (Camada 2 KPIs) ────────────────────────────────────────────
  registerAITool({
    key: 'financeiro.getOverdueInvoices',
    module: 'financeiro',
    layer: 'insight',
    label: 'Inadimplentes',
    description:
      'Lista members com mensalidade vencida há N+ dias. Retorna member_id + nome + atraso.',
    showInPersonas: ['admin', 'super_admin'],
    requiredPermissions: ['financeiro.read'],
    requiresConfirmation: false,
    argsSchemaJson: {
      type: 'object',
      properties: { minDaysOverdue: { type: 'integer', minimum: 1, maximum: 180 } },
    },
  })

  // ─── Tools bloqueadas explicitamente (ai-blocked no MVP) ───────────────
  // Estas tools NUNCA passam pelo assistente — só executam via UI/admin manual.
  // O assistente recebe erro "tool not available" se LLM tentar usar.
  registerAITool({
    key: 'members.delete',
    module: 'members',
    layer: 'action',
    label: '[BLOCKED] Apagar member',
    description: 'BLOQUEADO — LGPD art. 18 exige fluxo dedicado (data_subject_requests).',
    showInPersonas: ['admin'],
    requiresConfirmation: true,
    blocked: { reason: 'LGPD art. 18 fluxo dedicado em /app/dpo/requests' },
  })

  registerAITool({
    key: 'fisio.signEvolution',
    module: 'fisio',
    layer: 'action',
    label: '[BLOCKED] Assinar evolução',
    description:
      'BLOQUEADO — ICP-Brasil/lacre autenticado exigem profissional via UI dedicada (ADR 0032).',
    showInPersonas: ['professional_clinical'],
    requiresConfirmation: true,
    blocked: { reason: 'CFM 2.299 / COFFITO 414 exigem assinatura humana via UI dedicada' },
  })

  registerAITool({
    key: 'financeiro.chargeBatch',
    module: 'financeiro',
    layer: 'action',
    label: '[BLOCKED] Cobrar em lote',
    description:
      'BLOQUEADO — operação massa exige confirmação manual em /app/financeiro/cobrancas/lote.',
    showInPersonas: ['admin'],
    requiresConfirmation: true,
    blocked: {
      reason:
        'Operação de cobrança em massa exige fluxo dedicado com preview e auditoria reforçada',
    },
  })
}
