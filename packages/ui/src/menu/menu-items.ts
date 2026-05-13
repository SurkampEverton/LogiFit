/**
 * Registry canônico de módulos + itens — Sprint 00b Faixa A.
 *
 * Estrutura completa do spec do Sprint 00b (17 módulos). Apenas itens cujas
 * rotas EXISTEM hoje têm `url` definida; demais ficam comentados como TODO
 * para serem habilitados conforme features aterrissem em sprints futuros.
 *
 * **Não adicionar** `url` apontando pra rota inexistente — clique em 404 é
 * UX ruim. Editar este arquivo quando rota nasce.
 *
 * I18n: labels via `nav.{moduleId}.{itemId}` no catálogo `nav.json`
 * (3 locales: pt-BR/en-US/es-419 — regra 27 + ADR 0052).
 */
import type { MenuModule } from './types'

export const MENU_MODULES: MenuModule[] = [
  // ─── Início ──────────────────────────────────────────────────────────
  {
    id: 'inicio',
    labelKey: 'nav.modules.inicio',
    icon: '🏠',
    order: 10,
    items: [
      {
        id: 'home',
        labelKey: 'nav.inicio.home',
        url: '/app',
        icon: '·',
      },
    ],
  },

  // ─── Pessoas (CRM) ───────────────────────────────────────────────────
  {
    id: 'pessoas',
    labelKey: 'nav.modules.pessoas',
    icon: '👥',
    order: 20,
    items: [
      {
        id: 'members',
        labelKey: 'nav.pessoas.members',
        url: '/app/members',
        icon: '·',
        requiredPermission: 'member.read',
      },
      {
        id: 'persons',
        labelKey: 'nav.pessoas.persons',
        url: '/app/pessoas',
        icon: '·',
        requiredPermission: 'person.read',
      },
      // TODO Sprint 10 — /app/leads
      // TODO Sprint 01b — /app/profissionais (já existe sob /app/pessoas/[id]/registros)
      // TODO Sprint 15 — /app/fornecedores
    ],
  },

  // ─── Agenda (Sprint 03 Faixa B/C) ────────────────────────────────────
  {
    id: 'agenda',
    labelKey: 'nav.modules.agenda',
    icon: '📅',
    order: 30,
    items: [
      {
        id: 'agenda-week',
        labelKey: 'nav.agenda.week',
        url: '/app/agenda',
        icon: '·',
        // Sprint 03 ainda não tem permission 'appointment.read' no seed;
        // tenant_owner com 25 permissions já vê (regra de filtro: requiredPermission
        // omitido = visível pra todos autenticados; Sprint 04+ adiciona perm específica).
      },
    ],
  },

  // ─── Acesso (Academia) ───────────────────────────────────────────────
  // TODO Sprint 08 — vertical academia only
  {
    id: 'acesso',
    labelKey: 'nav.modules.acesso',
    icon: '🚪',
    order: 40,
    requiredVertical: 'academia',
    items: [],
  },

  // ─── Comercial ───────────────────────────────────────────────────────
  // TODO Sprint 04/05/10
  {
    id: 'comercial',
    labelKey: 'nav.modules.comercial',
    icon: '💼',
    order: 50,
    items: [],
  },

  // ─── Financeiro ──────────────────────────────────────────────────────
  // TODO Sprint 04 / 14 / 15
  {
    id: 'financeiro',
    labelKey: 'nav.modules.financeiro',
    icon: '💰',
    order: 60,
    items: [],
  },

  // ─── Fiscal ──────────────────────────────────────────────────────────
  // TODO Sprint 36
  {
    id: 'fiscal',
    labelKey: 'nav.modules.fiscal',
    icon: '🧾',
    order: 70,
    items: [],
  },

  // ─── Clínico (Fisio/Nutri) ───────────────────────────────────────────
  // TODO Sprint 20+ (vertical fisio/nutri)
  {
    id: 'clinico',
    labelKey: 'nav.modules.clinico',
    icon: '🩺',
    order: 80,
    // Sem requiredVertical fixo — Faixa C plugga: visível se tenant tem fisio OU nutri
    items: [],
  },

  // ─── Vigilância (Fisio) ──────────────────────────────────────────────
  // TODO Sprint 21+ (vertical fisio)
  {
    id: 'vigilancia',
    labelKey: 'nav.modules.vigilancia',
    icon: '🛡️',
    order: 90,
    requiredVertical: 'fisio',
    items: [],
  },

  // ─── Relacionamento ──────────────────────────────────────────────────
  // TODO Sprint 06 (Copilot) / Sprint 13 (WhatsApp)
  {
    id: 'relacionamento',
    labelKey: 'nav.modules.relacionamento',
    icon: '💬',
    order: 100,
    items: [],
  },

  // ─── Estoque ─────────────────────────────────────────────────────────
  // TODO Sprint 25+
  {
    id: 'estoque',
    labelKey: 'nav.modules.estoque',
    icon: '📦',
    order: 110,
    items: [],
  },

  // ─── Engajamento ─────────────────────────────────────────────────────
  // TODO Sprint 09
  {
    id: 'engajamento',
    labelKey: 'nav.modules.engajamento',
    icon: '🏆',
    order: 120,
    items: [],
  },

  // ─── RH ──────────────────────────────────────────────────────────────
  // TODO Sprint 23+
  {
    id: 'rh',
    labelKey: 'nav.modules.rh',
    icon: '👔',
    order: 130,
    items: [],
  },

  // ─── Compliance ──────────────────────────────────────────────────────
  // TODO Sprint 06 (Comitê IA) / Sprint 26 (titular requests)
  {
    id: 'compliance',
    labelKey: 'nav.modules.compliance',
    icon: '⚖️',
    order: 140,
    items: [],
  },

  // ─── Integrações ─────────────────────────────────────────────────────
  // TODO Sprint 17+
  {
    id: 'integracoes',
    labelKey: 'nav.modules.integracoes',
    icon: '🔌',
    order: 150,
    items: [],
  },

  // ─── Configurações ───────────────────────────────────────────────────
  {
    id: 'configuracoes',
    labelKey: 'nav.modules.configuracoes',
    icon: '⚙️',
    order: 160,
    items: [
      {
        id: 'users',
        labelKey: 'nav.configuracoes.users',
        url: '/app/settings/users',
        icon: '·',
        requiredPermission: 'user.read',
      },
      {
        id: 'security',
        labelKey: 'nav.configuracoes.security',
        url: '/seguranca',
        icon: '·',
      },
      {
        id: 'my-sessions',
        labelKey: 'nav.configuracoes.sessions',
        url: '/meu/sessoes',
        icon: '·',
      },
    ],
  },
]
