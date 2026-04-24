# ADR 0069 — Perfil do paciente como hub operacional + Modo Solo (autônomo)

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Durante a conversa pré-Sprint 00, o usuário descreveu o uso real do perfil do paciente (`/app/members/[id]`):

1. **Profissional pesquisa paciente** (Ctrl+K — ADR 0062) → **abre perfil** → **faz tudo que precisa administrar** sem sair da tela
2. **Cada módulo vê o perfil através da lente de sua especialidade** (Fisio vê prontuário/CIDs; Personal vê treino/avaliação; Nutri vê plano alimentar) — **mas com informações relevantes cruzadas** (ADR 0070 formaliza essa parte específica)
3. **Profissional autônomo** (personal trainer solo, fisio de consultório, nutri independente) **é tudo ao mesmo tempo** — não tem recepção separada; faz avaliação, atende, cobra, emite recibo, marca próxima sessão

Estado atual do plano:

- **Sprint 02** entrega `/app/members/[id]` como **grid de widgets** via `registerMemberWidget` (15+ widgets planejados)
- Sistema de widgets tem 4 gates (permission + vertical + presença + consent) — ADR 0005
- **Gap:** sem tabs por especialidade, sem sticky action bar, sem modo "atendimento em curso", sem registry de ações, sem workflow para o autônomo
- **Pricing** (ADR 0066) hoje tem 4 tiers (Starter/Pro/Business/Enterprise) + trial — não contempla o profissional autônomo (R$ 79 já é alto pra quem tem 30 clientes)

Decisões do usuário (2026-04-24):

Para o **hub operacional**:
1. Layout **top tabs** (não sidebar vertical)
2. **Modo atendimento** (timer + header diferenciado) no MVP
3. **Sidebar direita com histórico recente + favoritos** no MVP
4. **Ações inline** sempre (modais/sheets; não navegar para sub-páginas)
5. **Auto por role** sem customização de abas

Para o **profissional autônomo**:
1. **Plano Solo R$ 49/mês** (R$ 39 anual) · 1 user · 80 clientes
2. **Solo 1 vertical escolhida** ou **Solo Combo R$ 69 com todas**
3. **Modo detectado automaticamente** no signup (baseado no wizard + 1 user)
4. **Templates pré-carregados por profissão** no MVP
5. **Perfil sem tabs no modo Solo**, com tabs em Starter+ (auto por `mode`)

## Decision

### Parte 1 — Perfil do paciente como hub operacional

`/app/members/[id]` reestruturado em **4 camadas fixas**:

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER FIXO — identidade sempre visível                       │
│  (nome, idade, plano, telefone, status, alertas)                │
├────────────────────────────────────────────────────────────────┤
│  ACTION BAR — ações primárias role-aware                       │
│  [Nova consulta] [Agendar] [Mensagem] [Cobrar] [⚡ mais ▾]   │
├────────────────────────────────────────────────────────────────┤
│  TABS POR VISÃO (auto por role do user logado)                 │
│  [Geral] [Clínico] [Treino] [Alimentar] [Financeiro] [IA]      │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CORPO CONTEXTUAL                                               │
│  Widgets + ações inline da aba selecionada                      │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

### Visões por especialidade (tabs automáticas)

| Aba | Conteúdo | Ações primárias | Quem vê |
|---|---|---|---|
| **Geral** | identidade · timeline · alertas · agenda próxima · plano · financeiro resumido | Agendar · Mensagem · Cobrar · Ficha | Todos |
| **Clínico** | prontuário · evoluções · CIDs · exames · convênios · mídias clínicas | Nova consulta · Nova evolução · Prescrever · Solicitar exame · Alta · Guia TISS | Fisio, médico (consent cross-module para cross-vertical) |
| **Treino** | treinos ativos · histórico sessões · avaliação física · RPE · check-ins | Avaliação · Prescrever treino · Check-in · QR · Ajustar plano | Instrutor, personal, gerente |
| **Alimentar** | plano alimentar · diário · antropometria · exames labs · suplementos | Nova consulta · Plano alimentar · Antropometria · Exames · Suplementação | Nutri |
| **Financeiro** | contrato · invoices · ARs · créditos · cashback · histórico · cupons | Cobrar extra · Isentar · Alterar plano · Pausar · Recibo · Refund | Recepção, gerente, diretor |
| **Comunicação** | timeline de mensagens · emails · ligações · WhatsApp · tickets | WhatsApp · Email · Registrar ligação · Anexar documento | Todos |
| **IA** | Copilot contextual · sugestões · insights · risco churn | Perguntar ao Copilot · Ver sugestões | Permission `copilot.use` |

**Filtros das abas:**
- **Vertical do tenant** — tenant só-Academia não vê aba Clínico/Alimentar
- **Permission do user** — recepção não vê aba Clínico
- **Consent cross-module** — instrutor vendo aba Clínico exige consent do paciente (regra 6 + ADR 0005)
- **Presença de dados** — aba Alimentar some se member não tem plano nutri

**`?tab=auto`** na URL detecta role do user e abre tab default: Fisio → Clínico; Nutri → Alimentar; Instrutor → Treino; Recepção/Gerente → Geral.

### Registry de ações — `registerMemberAction`

Padrão consistente com `registerMemberWidget`, `registerQuickAction`, `registerCrossAlertHandler` existentes:

```ts
registerMemberAction({
  id: 'nova_consulta_fisio',
  label: 'Nova consulta',
  icon: 'stethoscope',
  tab: 'clinico',                          // aba onde aparece ('all' = header global)
  group: 'primary',                        // primary (action bar) / secondary (dropdown) / context (dentro de widget)
  order: 10,
  requiredPermissions: ['prontuario.write'],
  requiredVertical: 'fisio',
  consentPurpose: null,
  showWhen: (member) => !member.has_active_consulta_in_progress,
  handler: async (memberId, ctx) => {
    // opção 1: navegar
    // navigate(`/app/fisio/consultas/new?member=${memberId}`)
    // opção 2: inline (sheet/modal)
    return await openConsultaSheet(memberId, ctx)
  },
})
```

Cada sprint registra suas ações (a lista fica em `docs/sprints/*.md` — resumo):

- Sprint 02: Enviar mensagem, Atualizar ficha, Anexar doc, Registrar nota
- Sprint 03: Agendar, Remarcar, Cancelar
- Sprint 04: Cobrar extra, Alterar plano, Isentar, Pausar, Refund, Ver histórico
- Sprint 05: Aplicar cupom, Consumir crédito, Usar cashback
- Sprint 06: Perguntar ao Copilot
- Sprint 08: Check-in manual, Ver QR, Bloquear acesso
- Sprint 11: Prescrever treino, Ajustar workout, Registrar sessão
- Sprint 12: Nova avaliação, Comparar avaliações, Registrar medição
- Sprint 13: WhatsApp, Email, Régua personalizada
- Sprint 15: Gerar recibo, Segunda via, Emitir NFS-e manual
- Sprint 17: Upload XML NFe, Forçar sync NFs
- Sprint 20: Nova consulta, Nova evolução, Prescrever protocolo, Dar alta
- Sprint 21: Anexar mídia clínica, Gravar áudio
- Sprint 22: Gerar guia TISS, Vincular convênio, Solicitar autorização
- Sprint 27: Criar alerta clínico, Resolver alerta
- Sprint 29: Plano alimentar, Cardápio, Lista substituição
- Sprint 30: Suplementação, Solicitar exames labs
- Sprint 31: Iniciar teleconsulta, Revisar diário
- Sprint 32: Conectar dispositivo, Importar dados, Curar leitura
- Sprint 33: Upload exame, Revisar pipeline
- Sprint 34: Executar Nutri-Agent

### Modo "atendimento em curso"

Quando profissional clica `[Iniciar atendimento]`:

- **Header muda** para `🩺 Em atendimento: João Silva · ⏱ 05:23 de 30min`
- **Barra superior** ganha cor de destaque (vermelho-discreto)
- **Action bar** muda: `[Finalizar] [Pausar] [Anexar] [Registrar SOAP]`
- **Widget principal** entra em **modo edição** (SOAP ao vivo, formulário focado)
- **Ao navegar**, confirma "salvar rascunho?"
- **Timer visível** — ajuda profissional gerenciar tempo de sessão
- Ao `[Finalizar]`, sistema pergunta:
  1. Salvar evolução? (SOAP preenchido)
  2. Cobrar sessão? (se não está em pacote)
  3. Agendar próxima? (sugestão automática)

Schema mínimo:

```sql
attendance_sessions
  id uuid pk
  tenant_id uuid
  member_id uuid fk
  user_id uuid fk  -- profissional
  started_at timestamptz
  ended_at timestamptz nullable
  expected_duration_min int
  draft_content jsonb  -- SOAP rascunho enquanto sessão ativa
  status enum ('active','paused','finalized','cancelled')
```

### Sidebar direita — histórico recente + favoritos

Desktop (esconde em mobile/tablet):

```
┌─ Histórico ──────────┐
│ ⭐ Maria Souza       │
│ ⭐ Pedro Alves       │
│ ● João Silva (agora) │
│ • Ana Paula          │
│ • Carlos Mendes      │
│ ...                  │
└──────────────────────┘
```

Últimos 10 pacientes visitados por user + favoritos fixados. Schema:

```sql
user_member_favorites
  user_id, member_id, pinned_at
  primary key (user_id, member_id)

user_recent_members  -- ring buffer, mantém últimos 10
  user_id, member_id, visited_at
  primary key (user_id, member_id)
```

### Ações inline sempre

Decisão #4: **evitar navegar** sempre que possível — ações executam em modal/sheet lateral:

- `[Nova consulta]` → sheet lateral com SOAP editor + salvar/fechar
- `[Cobrar extra]` → modal com preview + gerar PIX/cartão
- `[Anexar documento]` → modal de upload inline
- `[Mensagem]` → sheet com template + histórico de conversas

Reduz perda de contexto. Profissional permanece na página do paciente 80%+ do tempo.

Apenas ações **estruturalmente complexas** navegam:
- `[Gerar guia TISS]` → `/app/fisio/faturamento/new?member=...` (fluxo multi-tela TISS)
- `[Ver histórico completo]` → `/app/members/[id]/timeline`

### Parte 2 — Modo Solo (profissional autônomo)

Detectado automaticamente no signup:

```sql
tenants
  ...
  mode enum ('solo','clinic','chain','hospital') default 'clinic'
```

Se wizard detecta `perfil='autônomo'` + `users=1` + plano Solo → `mode='solo'`.

### UX adaptada ao Modo Solo

**`/app/members/[id]` sem tabs** — visão única vertical, scroll:

```
Header fixo + Action bar (action bar maior, com todas as ações do profissional)
              ↓
Bloco: Informações Pessoais + Plano (side-by-side)
              ↓
Bloco: Histórico Clínico (se Fisio/Nutri) OU Treino (se Personal)
              ↓
Bloco: Próximos Agendamentos
              ↓
Bloco: Avaliações Físicas
              ↓
Bloco: Financeiro
              ↓
Bloco: Anotações Rápidas
              ↓
Bloco: Comunicação
```

Tudo numa página. Sem tabs porque o autônomo é fisio + personal + recepção + gerente ao mesmo tempo.

### Dashboard `/app` no Modo Solo

Foco na agenda do dia + cobranças + mensal:

```
Agenda de hoje (realizado/próximo/livre)
Cobranças em aberto (count + total)
Resumo mensal (faturado/recebido/atendimentos/novos)
[+ Novo paciente] [+ Novo serviço] [💬 WhatsApp]
```

### Onboarding wizard

`/signup` pergunta:

1. **Como você atua?** — Autônomo / Clínica pequena / Média / Rede
2. **Qual sua profissão?** (se autônomo) — Personal (CREF) / Fisio (CREFITO) / Nutri (CRN) / Pilates/Yoga / Psicólogo / Esteticista / Combo
3. **Sugere plano** apropriado
4. **Carrega templates** pré-configurados por profissão

### Templates por profissão (seed inicial ao ativar)

**Personal Trainer CREF:**
- `services`: Sessão Personal 1h (R$ 120), Avaliação Física (R$ 80), Pacote 8 sessões (R$ 880)
- Templates avaliação: Pollock 7 dobras, TMB Harris-Benedict, PAR-Q
- Planilha treino A/B/C simples
- Ficha anamnese esportiva

**Fisioterapeuta CREFITO:**
- `services`: Sessão Fisio 50min (R$ 180), Avaliação inicial (R$ 250), Pacote 10 (R$ 1.700)
- Templates SOAP curto e completo
- Escalas funcionais (EVA, Oswestry, DASH, SF-36, Berg, Tampa, TUG, WOMAC)
- CIDs comuns por especialidade
- Protocolos terapêuticos (McKenzie, Maitland, PNF)

**Nutricionista CRN:**
- `services`: Consulta inicial (R$ 250), Retorno (R$ 150), Pacote 3 meses (R$ 1.200)
- Templates anamnese alimentar, recordatório 24h
- Planos alimentares base (perda/ganho/vegetariano/diabético)
- Antropometria (Jackson-Pollock, InBody)

**Pilates/Yoga/Funcional:**
- `services`: Aula avulsa (R$ 70), Pacote 8 aulas (R$ 480), Avaliação inicial (R$ 100)
- Ficha anamnese
- Sequências base (iniciante/intermediário/avançado)

**Psicólogo CRP:**
- `services`: Sessão 50min (R$ 180), Primeira consulta (R$ 220)
- Templates sessão (DSM-5 light, relato sigiloso)
- Escalas (Beck, HAD, GAD-7)
- Prontuário simples com audit

**Esteticista:**
- `services`: Limpeza de pele (R$ 120), Drenagem (R$ 150), Pacote 10 sessões (R$ 1.200)
- Anamnese estética
- Fichas por procedimento

### Fiscal adaptado ao Solo

Novo bloco em `/app/settings/fiscal`:

```
Regime fiscal:
○ MEI — Microempreendedor Individual
  CNPJ + DAS R$ 71,60/mês fixo
  Emite recibo simples (alguns municípios exigem NFS-e)
  Alerta automático quando chegar a R$ 65k faturado/ano (teto R$ 81k)

○ ME Simples Nacional
  Anexo III ou V (escolher)
  Emite NFS-e via Focus NFe
  DAS calculado sobre faturamento

○ PF Autônomo
  Emite RPA (Recibo de Pagamento Autônomo)
  INSS 11% retido pelo tomador (se PJ)
  IRRF tabela progressiva
  ISS retido quando município exige
```

Simplifica vida do autônomo — não precisa configurar Focus NFe se MEI no interior.

## Consequences

### Positivas

- **Hub operacional reduz fricção** — profissional faz tudo em 1 tela, ~3 cliques para fechar ciclo
- **Modo Solo captura mercado gigantesco** (~700k profissionais autônomos saúde/fitness no Brasil) antes desatendido
- **Onboarding inteligente** — wizard detecta perfil + pré-configura tudo; usabilidade em 10 minutos do primeiro login
- **Templates por profissão** acelera adoção
- **Ações inline preservam contexto** — profissional não se perde
- **Modo atendimento com timer** diferencia de ERP genérico; foco em workflow clínico
- **Registry de ações** cresce com sprints sem refactor central
- **Tabs auto por role** — UX "inteligente sem esforço"
- **Fiscal simplificado MEI/RPA** resolve pain real do autônomo
- **Sidebar de histórico** reduz tempo de troca entre pacientes

### Negativas (mitigáveis)

- **Complexidade do perfil** cresce significativamente — Sprint 02 vira mais denso; mitigado por entregar iterativamente (widgets + registry primeiro; modo atendimento como stretch se apertar)
- **Manutenção de templates por profissão** — 7 profissões × atualizações; LogiFit admin cura; tenant pode override
- **Modo Solo reduz margem** (R$ 49 com 70% margem) — mas captura volume; LTV de solo que cresce e vira Starter compensa
- **Sidebar direita só desktop** — mobile não tem espaço; aceitar trade-off (workflow mobile já é otimizado por tabs)
- **Consent cross-module pode ser pedido excessivamente** — wizard guia com exemplos práticos; paciente entende valor da integração

### Riscos não endereçados

- **Profissional autônomo migra para Starter quando cresce** — boa notícia para LogiFit (LTV cresce); mas se migration em massa, revisar quotas Solo para pressure upgrade
- **Templates errados ou desatualizados** podem causar erro clínico — review jurídico + disclaimer "edite antes de usar no primeiro paciente"
- **LGPD cross-module consent** — paciente pode revogar, perdendo insights; aceitar (regra 6)
- **Performance com 80+ pacientes ativos** — queries do perfil precisam ser eficientes; cache + índices

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Sidebar vertical em vez de top tabs | Top tabs é mobile-friendly; sidebar ocupa espaço horizontal já escasso |
| Modo atendimento Fase 2 | Fisio precisa desde o dia 1; é diferencial clínico real; risco baixo de scope |
| Sidebar recente só no desktop — **aceita** como trade-off | Mobile workflow já é otimizado |
| Ações navegam sempre | Profissional perde contexto; fluxo lento |
| User customiza abas fixadas | Complexidade sem ganho real no MVP |
| Plano Solo inclui todas verticais por R$ 59 | Menos granular; autônomo personal não paga por Fisio que não usa |
| Modo Solo toggle manual | Fricção; auto-detecção com override é melhor UX |
| Templates Fase 2 | Autônomo perde primeiros dias sem templates; adoção mais lenta |
| Solo sem ERP avançado (Focus NFe fora) | Some tenants autônomos são MEI + NFS-e municipal obrigatória (SP, RJ) |

## Escopo de impacto

**Novos ADRs:** este (0069) + [ADR 0070](0070-insights-cross-module-timeline-integrada.md) (insights).

**Sprints ajustados:**

- **Sprint 01a** — onboarding wizard + `tenants.mode` + detecção de perfil; rota `/signup` com fluxo guiado; `user_member_favorites` + `user_recent_members`
- **Sprint 02** — `/app/members/[id]` reestruturado com header fixo + action bar + tabs + sidebar direita + registry `registerMemberAction` + modo atendimento + `attendance_sessions` schema; adapta para `mode='solo'` (sem tabs)
- **Sprint 03** — agenda pessoal do autônomo como visão padrão em `mode='solo'`
- **Sprint 04** — plano Solo no seed `logifit_plans`; pricing revisado: Solo R$ 49/Solo Combo R$ 69/Starter R$ 99/Pro R$ 199/Business R$ 449/Enterprise
- **Sprint 05** — templates pré-carregados por profissão (`services` + escalas + CIDs + protocolos)
- **Sprint 07** — dashboard `/app` detecta `mode` e renderiza visão apropriada (Solo vs clinic)
- **Sprint 15** — recibo simples (MEI/autônomo) + RPA opcional
- **Sprint 20** — sheet lateral com SOAP editor inline + modo atendimento
- **Sprint 26** — portal paciente enxuto em `mode='solo'`
- **Sprint 36** — NFS-e opcional (não obrigatória) para Solo/MEI

**Docs:**
- `docs/modulos.md` — módulo "Hub operacional do paciente" + "Modo Solo" + "Templates por profissão"
- `docs/comercial.md` — pricing com 5 tiers (+ Solo)
- `CLAUDE.md` — modelo comercial atualizado
- `CHANGELOG.md` — entrada

**Também afeta ADR 0066 (pricing)** — precisa revisar com novo plano Solo + reestruturação.

## Related

- Reforça [ADR 0005 — RBAC com consent cross-module](0005-rbac-com-consent-cross-module.md)
- Estende [ADR 0062 — Pesquisa global Ctrl+K](0062-pesquisa-global-command-palette.md) — `?tab=auto` ao navegar
- Estende [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — adiciona Solo; reestrutura
- Estende [ADR 0068 — Catálogo de serviços](0068-catalogo-servicos-precos-contextuais-link-financeiro.md) — templates consomem
- Prepara [ADR 0070 — Insights cross-module](0070-insights-cross-module-timeline-integrada.md) — que completa a visão integrada
- Fontes: benchmarks UX Linear/Notion (command palette → hub), EMRs Epic/Cerner (modo atendimento), Tecnofit/iClinic (templates de especialidade)
