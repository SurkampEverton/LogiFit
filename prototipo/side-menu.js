/*
 * SideMenu — registry + render + interações (Sprint 00b)
 *
 * Menu hamburger overlay com organização por módulos e filtros
 * automáticos de permission/vertical/consent/featureFlag.
 *
 * Protótipo standalone: user + tenant mockados em window.LogiFitSession.
 * Em produção (apps/web), filtros consultam JWT + has_permission() SQL.
 *
 * Referências:
 * - docs/sprints/00b-menu-lateral.md
 * - docs/decisions/0063-responsividade-total-mobile-first.md
 * - docs/decisions/0062-pesquisa-global-command-palette.md
 */

(() => {
  'use strict';

  // =========================================================================
  // 1. Session mock — substituído por JWT real em produção
  // =========================================================================
  const defaultSession = {
    user: {
      id: 'user-mock',
      name: 'Everton Surkamp',
      initials: 'ES',
      roleLabel: 'Gerente da rede',
      permissions: [
        // Financeiro
        'financeiro.ap.read', 'financeiro.ap.write',
        'financeiro.ar.read', 'financeiro.ar.write',
        'financeiro.nfe.read', 'financeiro.bank.read',
        // Fiscal
        'fiscal.read', 'fiscal.emit',
        // Pessoas
        'member.read', 'member.write',
        'lead.read', 'supplier.read', 'profissional.read',
        // Agenda
        'agenda.read', 'agenda.write',
        // Acesso academia
        'acesso.read', 'acesso.write',
        // Dashboard
        'dashboard.gerente', 'dashboard.recepcao',
        // Configs
        'settings.companies', 'settings.users', 'settings.roles',
        // Relacionamento
        'mensagens.read', 'copilot.use',
        // Engajamento
        'engajamento.read',
        // Comercial
        'funil.read', 'ofertas.read',
      ],
    },
    tenant: {
      id: 'tenant-mock',
      name: 'Vital Club Rede',
      activeVerticals: ['academia'], // tenant só-Academia no protótipo
      featureFlags: {
        rbac_v1: true,
        dashboard_v1: true,
        erp_financeiro_v1: true,
        fiscal_focus_v1: false,   // Sprint 36 ainda não ligou
        mensagens_v1: true,
        copilot_v1: true,
        acesso_v1: true,
        avaliacoes_v1: false,
      },
    },
    activeConsents: ['cross_module_academia_fisio'],
  };

  window.LogiFitSession = window.LogiFitSession || defaultSession;

  // =========================================================================
  // 2. Registry de módulos e itens
  // =========================================================================
  const modules = new Map();   // id -> { id, label, order, icon? }
  const items = [];            // MenuItem[]

  /**
   * @param {{ id: string, label: string, order?: number }} meta
   */
  function registerMenuModule(meta) {
    modules.set(meta.id, { order: 100, ...meta });
  }

  /**
   * @typedef {Object} MenuItem
   * @property {string} id
   * @property {string} module       - id do módulo (deve estar registrado)
   * @property {string} label        - texto visível
   * @property {string} icon         - id do símbolo SVG (#i-xxx)
   * @property {string} url          - rota destino
   * @property {string} [requiredPermission]
   * @property {string} [requiredVertical]
   * @property {string} [requiredConsent]
   * @property {string} [featureFlag]
   * @property {number} [order]
   * @property {() => {text: string, severity?: 'default'|'warning'|'danger'} | null} [badge]
   * @property {MenuItem[]} [children]
   */
  function registerMenuItem(meta) {
    items.push({ order: 100, ...meta });
  }

  // =========================================================================
  // 3. Filtros
  // =========================================================================
  function isItemVisible(item, session) {
    if (item.requiredPermission && !session.user.permissions.includes(item.requiredPermission)) return false;
    if (item.requiredVertical && !session.tenant.activeVerticals.includes(item.requiredVertical)) return false;
    if (item.requiredConsent && !session.activeConsents.includes(item.requiredConsent)) return false;
    if (item.featureFlag && !session.tenant.featureFlags[item.featureFlag]) return false;
    return true;
  }

  function getVisibleModulesAndItems(session) {
    const byModule = new Map();
    for (const item of items) {
      if (!isItemVisible(item, session)) continue;
      if (!byModule.has(item.module)) byModule.set(item.module, []);
      byModule.get(item.module).push(item);
    }
    // ordenar itens dentro de cada módulo
    for (const list of byModule.values()) list.sort((a, b) => a.order - b.order);
    // retornar módulos ordenados + seus itens
    return Array.from(modules.values())
      .sort((a, b) => a.order - b.order)
      .map(m => ({ module: m, items: byModule.get(m.id) || [] }))
      .filter(group => group.items.length > 0);
  }

  // =========================================================================
  // 4. Render
  // =========================================================================
  function render(root, session, currentUrl) {
    const groups = getVisibleModulesAndItems(session);
    const collapsed = readCollapsedState();

    const html = `
      <div class="side-menu__header">
        <span class="side-menu__brand">
          <span class="side-menu__brand-mark">L</span>
          <span>LogiFit</span>
        </span>
        <button class="side-menu__close" data-side-menu-close aria-label="Fechar menu">
          <svg class="icon" width="20" height="20" viewBox="0 0 24 24">
            <use href="#i-x"/>
          </svg>
        </button>
      </div>
      <nav class="side-menu__nav" role="navigation">
        ${groups.map(g => renderModule(g, currentUrl, collapsed)).join('')}
      </nav>
      <div class="side-menu__footer">
        <span class="side-menu__user-avatar">${session.user.initials}</span>
        <div class="side-menu__user-info">
          <div class="side-menu__user-name">${session.user.name}</div>
          <div class="side-menu__user-meta">${session.tenant.name} · ${session.user.roleLabel}</div>
        </div>
        <button class="side-menu__logout" aria-label="Sair">
          <svg class="icon" width="18" height="18" viewBox="0 0 24 24">
            <use href="#i-logout"/>
          </svg>
        </button>
      </div>
    `;
    root.innerHTML = html;

    // listeners de colapso de módulo
    root.querySelectorAll('.side-menu__module-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const section = btn.closest('.side-menu__module');
        const moduleId = section.dataset.module;
        section.classList.toggle('side-menu__module--collapsed');
        const newCollapsed = section.classList.contains('side-menu__module--collapsed');
        writeCollapsed(moduleId, newCollapsed);
      });
    });
  }

  function renderModule(group, currentUrl, collapsed) {
    const isCollapsed = collapsed[group.module.id] === true;
    return `
      <div class="side-menu__module ${isCollapsed ? 'side-menu__module--collapsed' : ''}" data-module="${group.module.id}">
        <button class="side-menu__module-header" aria-expanded="${!isCollapsed}">
          <span>${group.module.label}</span>
          <svg class="side-menu__module-chevron icon" width="14" height="14" viewBox="0 0 24 24">
            <use href="#i-chevron-down"/>
          </svg>
        </button>
        <div class="side-menu__module-items">
          ${group.items.map(item => renderItem(item, currentUrl)).join('')}
        </div>
      </div>
    `;
  }

  function renderItem(item, currentUrl) {
    const isActive = currentUrl === item.url;
    const badge = typeof item.badge === 'function' ? item.badge() : null;
    return `
      <a href="${item.url}" class="side-menu__link ${isActive ? 'side-menu__link--active' : ''}" data-menu-item="${item.id}">
        <svg class="side-menu__link-icon" viewBox="0 0 24 24"><use href="#${item.icon}"/></svg>
        <span class="side-menu__link-label">${item.label}</span>
        ${badge ? `<span class="side-menu__link-badge ${badge.severity ? 'side-menu__link-badge--' + badge.severity : ''}">${badge.text}</span>` : ''}
      </a>
    `;
  }

  // =========================================================================
  // 5. Collapsed state (localStorage)
  // =========================================================================
  function readCollapsedState() {
    try {
      const userId = window.LogiFitSession.user.id;
      return JSON.parse(localStorage.getItem(`logifit:side-menu:collapsed:${userId}`) || '{}');
    } catch {
      return {};
    }
  }
  function writeCollapsed(moduleId, collapsed) {
    try {
      const userId = window.LogiFitSession.user.id;
      const key = `logifit:side-menu:collapsed:${userId}`;
      const state = readCollapsedState();
      state[moduleId] = collapsed;
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }

  // =========================================================================
  // 6. Open/Close + focus trap + atalhos + swipe
  // =========================================================================
  function initController({ menuEl, backdropEl, triggerEl }) {
    let previouslyFocused = null;
    let touchStartX = null;

    function open() {
      if (menuEl.classList.contains('side-menu--open')) return;
      previouslyFocused = document.activeElement;
      menuEl.classList.add('side-menu--open');
      backdropEl.classList.add('side-menu-backdrop--open');
      document.body.classList.add('side-menu-open');
      menuEl.setAttribute('aria-hidden', 'false');
      // foca o primeiro item focável do menu
      requestAnimationFrame(() => {
        const first = menuEl.querySelector('button, [href]');
        if (first) first.focus();
      });
    }

    function close() {
      if (!menuEl.classList.contains('side-menu--open')) return;
      menuEl.classList.remove('side-menu--open');
      backdropEl.classList.remove('side-menu-backdrop--open');
      document.body.classList.remove('side-menu-open');
      menuEl.setAttribute('aria-hidden', 'true');
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    }

    function toggle() {
      if (menuEl.classList.contains('side-menu--open')) close();
      else open();
    }

    // Click backdrop → fecha
    backdropEl.addEventListener('click', close);

    // Botão close interno
    menuEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-side-menu-close]')) close();
    });

    // Click no trigger (☰)
    if (triggerEl) triggerEl.addEventListener('click', toggle);

    // Tecla Esc fecha; Ctrl/Cmd+B abre/fecha
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menuEl.classList.contains('side-menu--open')) {
        e.preventDefault();
        close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggle();
      }
    });

    // Focus trap — Tab circula dentro do menu
    menuEl.addEventListener('keydown', (e) => {
      if (!menuEl.classList.contains('side-menu--open')) return;
      if (e.key !== 'Tab') return;
      const focusable = menuEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Swipe em touch — abre da borda esquerda; fecha no menu aberto
    document.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (touchStartX === null) return;
      const touchEndX = e.changedTouches[0].clientX;
      const delta = touchEndX - touchStartX;
      // abre se começou perto da borda esquerda e arrastou para direita
      if (touchStartX < 20 && delta > 50 && !menuEl.classList.contains('side-menu--open')) {
        open();
      }
      // fecha se menu aberto e arrastou pra esquerda
      if (menuEl.classList.contains('side-menu--open') && delta < -50) {
        // só se touchStart estava dentro do menu
        if (touchStartX < menuEl.getBoundingClientRect().right) {
          close();
        }
      }
      touchStartX = null;
    }, { passive: true });

    // Click em item de navegação: fecha em mobile/tablet; mantém em desktop
    menuEl.addEventListener('click', (e) => {
      const link = e.target.closest('[data-menu-item]');
      if (link && window.innerWidth < 1024) {
        close();
      }
    });

    return { open, close, toggle };
  }

  // =========================================================================
  // 7. Boot — injeta DOM + registra módulos/itens padrão
  // =========================================================================
  function injectDom() {
    // backdrop
    let backdrop = document.querySelector('.side-menu-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'side-menu-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      document.body.appendChild(backdrop);
    }
    // menu container
    let menu = document.querySelector('.side-menu');
    if (!menu) {
      menu = document.createElement('aside');
      menu.className = 'side-menu';
      menu.setAttribute('role', 'dialog');
      menu.setAttribute('aria-modal', 'true');
      menu.setAttribute('aria-label', 'Menu principal');
      menu.setAttribute('aria-hidden', 'true');
      document.body.appendChild(menu);
    }
    return { menu, backdrop };
  }

  function seedDefaults() {
    // ===== Módulos (ordem determinística) =====
    registerMenuModule({ id: 'inicio',         label: 'Início',          order: 10 });
    registerMenuModule({ id: 'pessoas',        label: 'Pessoas',         order: 20 });
    registerMenuModule({ id: 'agenda',         label: 'Agenda',          order: 30 });
    registerMenuModule({ id: 'acesso',         label: 'Acesso',          order: 40 });
    registerMenuModule({ id: 'comercial',      label: 'Comercial',       order: 50 });
    registerMenuModule({ id: 'financeiro',     label: 'Financeiro',      order: 60 });
    registerMenuModule({ id: 'fiscal',         label: 'Fiscal',          order: 70 });
    registerMenuModule({ id: 'clinico',        label: 'Clínico',         order: 80 });
    registerMenuModule({ id: 'vigilancia',     label: 'Vigilância',      order: 85 });
    registerMenuModule({ id: 'relacionamento', label: 'Relacionamento',  order: 90 });
    registerMenuModule({ id: 'estoque',        label: 'Estoque',         order: 100 });
    registerMenuModule({ id: 'engajamento',    label: 'Engajamento',     order: 110 });
    registerMenuModule({ id: 'rh',             label: 'RH',              order: 120 });
    registerMenuModule({ id: 'compliance',     label: 'Compliance',      order: 130 });
    registerMenuModule({ id: 'integracoes',    label: 'Integrações',     order: 140 });
    registerMenuModule({ id: 'configuracoes',  label: 'Configurações',   order: 200 });

    // ===== Itens (cada sprint registra os seus; protótipo simula tudo) =====

    // Início (Sprint 07)
    registerMenuItem({ id: 'dashboard.gerente', module: 'inicio', label: 'Dashboard', icon: 'i-home', url: '07-dashboard.html', requiredPermission: 'dashboard.gerente', featureFlag: 'dashboard_v1', order: 10 });
    registerMenuItem({ id: 'dashboard.recepcao', module: 'inicio', label: 'Recepção (live)', icon: 'i-bell', url: '#', requiredPermission: 'dashboard.recepcao', featureFlag: 'dashboard_v1', order: 20 });

    // Pessoas (Sprint 01a + 02 + 10)
    registerMenuItem({ id: 'pessoas.central', module: 'pessoas', label: 'Cadastro central', icon: 'i-users', url: '#', requiredPermission: 'member.read', order: 5 });
    registerMenuItem({ id: 'pessoas.members', module: 'pessoas', label: 'Alunos/pacientes', icon: 'i-users', url: '02-member-home.html', requiredPermission: 'member.read', order: 10 });
    registerMenuItem({ id: 'pessoas.leads', module: 'pessoas', label: 'Leads (funil)', icon: 'i-target', url: '#', requiredPermission: 'lead.read', order: 20 });
    registerMenuItem({ id: 'pessoas.profissionais', module: 'pessoas', label: 'Profissionais', icon: 'i-stethoscope', url: '#', requiredPermission: 'profissional.read', order: 30 });
    registerMenuItem({ id: 'pessoas.suppliers', module: 'pessoas', label: 'Fornecedores', icon: 'i-truck', url: '#', requiredPermission: 'supplier.read', order: 40 });

    // Agenda (Sprint 03)
    registerMenuItem({ id: 'agenda.agendamentos', module: 'agenda', label: 'Agendamentos', icon: 'i-calendar', url: '#', requiredPermission: 'agenda.read', order: 10 });
    registerMenuItem({ id: 'agenda.recursos', module: 'agenda', label: 'Recursos', icon: 'i-grid', url: '#', requiredPermission: 'agenda.write', order: 20 });

    // Acesso Academia (Sprint 08) — só academia
    registerMenuItem({ id: 'acesso.checkins', module: 'acesso', label: 'Check-ins ao vivo', icon: 'i-shield', url: '#', requiredPermission: 'acesso.read', requiredVertical: 'academia', featureFlag: 'acesso_v1', order: 10 });
    registerMenuItem({ id: 'acesso.catracas', module: 'acesso', label: 'Catracas', icon: 'i-door', url: '#', requiredPermission: 'acesso.write', requiredVertical: 'academia', featureFlag: 'acesso_v1', order: 20 });
    registerMenuItem({ id: 'acesso.bloqueios', module: 'acesso', label: 'Bloqueios', icon: 'i-ban', url: '#', requiredPermission: 'acesso.read', requiredVertical: 'academia', featureFlag: 'acesso_v1', order: 30 });

    // Comercial (Sprint 05 + 10)
    registerMenuItem({ id: 'comercial.funil', module: 'comercial', label: 'Funil de vendas', icon: 'i-target', url: '#', requiredPermission: 'funil.read', order: 10 });
    registerMenuItem({ id: 'comercial.ofertas', module: 'comercial', label: 'Ofertas/cupons', icon: 'i-tag', url: '#', requiredPermission: 'ofertas.read', order: 20 });
    registerMenuItem({ id: 'comercial.planos', module: 'comercial', label: 'Planos', icon: 'i-grid', url: '#', requiredPermission: 'ofertas.read', order: 30 });

    // Financeiro (Sprint 04 + 15 + 17)
    registerMenuItem({ id: 'financeiro.ap', module: 'financeiro', label: 'Contas a Pagar', icon: 'i-receipt', url: '#', requiredPermission: 'financeiro.ap.read', featureFlag: 'erp_financeiro_v1', order: 10, badge: () => ({ text: '3', severity: 'warning' }) });
    registerMenuItem({ id: 'financeiro.ar', module: 'financeiro', label: 'Contas a Receber', icon: 'i-receipt', url: '#', requiredPermission: 'financeiro.ar.read', featureFlag: 'erp_financeiro_v1', order: 20 });
    registerMenuItem({ id: 'financeiro.nfe', module: 'financeiro', label: 'Inbox NF-e', icon: 'i-inbox', url: '#', requiredPermission: 'financeiro.nfe.read', order: 30, badge: () => ({ text: '12', severity: 'default' }) });
    registerMenuItem({ id: 'financeiro.bancos', module: 'financeiro', label: 'Bancos/Extrato', icon: 'i-wallet', url: '#', requiredPermission: 'financeiro.bank.read', order: 40 });
    registerMenuItem({ id: 'financeiro.fluxo', module: 'financeiro', label: 'Fluxo de caixa', icon: 'i-trending-up', url: '#', requiredPermission: 'financeiro.bank.read', order: 50 });

    // Fiscal (Sprint 36)
    registerMenuItem({ id: 'fiscal.emissoes', module: 'fiscal', label: 'Emissões', icon: 'i-file-text', url: '#', requiredPermission: 'fiscal.read', featureFlag: 'fiscal_focus_v1', order: 10 });
    registerMenuItem({ id: 'fiscal.retencoes', module: 'fiscal', label: 'Retenções', icon: 'i-percent', url: '#', requiredPermission: 'fiscal.read', order: 20 });

    // Clínico (Sprint 20/21/22) — só Fisio
    registerMenuItem({ id: 'clinico.prontuario', module: 'clinico', label: 'Prontuário', icon: 'i-clipboard', url: '#', requiredPermission: 'prontuario.read', requiredVertical: 'fisio', order: 10 });
    registerMenuItem({ id: 'clinico.convenios', module: 'clinico', label: 'Convênios TISS', icon: 'i-shield', url: '#', requiredPermission: 'convenios.read', requiredVertical: 'fisio', order: 20 });

    // Vigilância (Sprint 25)
    registerMenuItem({ id: 'vigilancia.equipamentos', module: 'vigilancia', label: 'Equipamentos', icon: 'i-dumbbell', url: '#', requiredPermission: 'vigilancia.read', requiredVertical: 'fisio', order: 10 });

    // Relacionamento (Sprint 06 + 13)
    registerMenuItem({ id: 'relacionamento.mensagens', module: 'relacionamento', label: 'Mensagens', icon: 'i-message', url: '#', requiredPermission: 'mensagens.read', featureFlag: 'mensagens_v1', order: 10 });
    registerMenuItem({ id: 'relacionamento.copilot', module: 'relacionamento', label: 'Copilot', icon: 'i-sparkles', url: '#', requiredPermission: 'copilot.use', featureFlag: 'copilot_v1', order: 20 });

    // Estoque (Sprint 24)
    registerMenuItem({ id: 'estoque.itens', module: 'estoque', label: 'Itens', icon: 'i-package', url: '#', requiredPermission: 'estoque.read', order: 10 });

    // Engajamento (Sprint 09)
    registerMenuItem({ id: 'engajamento.conquistas', module: 'engajamento', label: 'Conquistas', icon: 'i-trophy', url: '#', requiredPermission: 'engajamento.read', order: 10 });
    registerMenuItem({ id: 'engajamento.metas', module: 'engajamento', label: 'Metas', icon: 'i-target', url: '#', requiredPermission: 'engajamento.read', order: 20 });

    // RH (Sprint 23)
    registerMenuItem({ id: 'rh.contratos', module: 'rh', label: 'Contratos profissionais', icon: 'i-file-text', url: '#', requiredPermission: 'rh.read', order: 10 });

    // Compliance (Sprint 01b)
    registerMenuItem({ id: 'compliance.comite-ia', module: 'compliance', label: 'Comitê de IA', icon: 'i-bot', url: '#', requiredPermission: 'compliance.read', order: 10 });

    // Integrações (Sprint 32 + Wellness)
    registerMenuItem({ id: 'integracoes.devices', module: 'integracoes', label: 'Device Hub', icon: 'i-watch', url: '#', requiredPermission: 'devices.read', order: 10 });

    // Configurações
    registerMenuItem({ id: 'config.empresas', module: 'configuracoes', label: 'Empresas e unidades', icon: 'i-building', url: '#', requiredPermission: 'settings.companies', order: 10 });
    registerMenuItem({ id: 'config.users', module: 'configuracoes', label: 'Usuários', icon: 'i-users', url: '#', requiredPermission: 'settings.users', order: 20 });
    registerMenuItem({ id: 'config.roles', module: 'configuracoes', label: 'Papéis e permissões', icon: 'i-key', url: '#', requiredPermission: 'settings.roles', order: 30 });
  }

  function boot() {
    const { menu, backdrop } = injectDom();
    seedDefaults();
    render(menu, window.LogiFitSession, window.location.pathname.split('/').pop());

    // trigger pode estar em qualquer topbar da app
    const trigger = document.querySelector('[data-side-menu-trigger]');
    const controller = initController({ menuEl: menu, backdropEl: backdrop, triggerEl: trigger });

    // API pública
    window.LogiFitSideMenu = {
      open: controller.open,
      close: controller.close,
      toggle: controller.toggle,
      registerMenuModule,
      registerMenuItem,
      rerender: () => render(menu, window.LogiFitSession, window.location.pathname.split('/').pop()),
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
