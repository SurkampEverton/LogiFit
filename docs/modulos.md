# Catálogo de Módulos

Visão funcional do sistema, agrupada por **área**. Cada módulo tem "quais verticais usam" e "qual sprint entrega", para que trabalho cross-vertical fique visível de antemão.

> Complementar a [`roadmap.md`](roadmap.md) (temporal) e a [`sprints/`](sprints/) (executável). Este arquivo olha **para dentro** — o que o sistema é.

---

## Áreas

| Área | O que é |
|---|---|
| `fundação` | Infra, auth, multi-tenancy, RBAC, audit — base técnica não-funcional. Não é feature de negócio. |
| `geral` | Serve todas as verticais (cadastro de pessoa, agenda, financeiro, copilot, dashboard). Módulos cross-vertical moram aqui. |
| `academia` | Específico da vertical Academia (modalidades, QR, catraca, check-in). |
| `fisio` | Específico da vertical Fisioterapia (prontuário, assinatura ICP-Brasil, evolução com mídias). |
| `nutri` | Específico da vertical Nutrição (antropometria, cardápios, nutri-agent). |

**Legenda de status:** `todo` · `doing` · `done` · `blocked` · `futuro` (fora da janela atual de planejamento).

---

## Fundação

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Identidade + MFA | Login (magic link + OAuth), TOTP obrigatório para profissionais | todas | 01a | todo |
| Hierarquia group→tenant→company→unit | Schema multi-tenant com RLS raiz, 4 cenários canônicos no seed | todas | 01a | todo |
| Login contextual + troca de tenant | Usuário multi-tenant escolhe contexto; JWT é reassinado | todas | 01a | todo |
| RBAC com scope | Roles + permissions + scope (`group`/`tenant`/`company`/`unit`) | todas | 01b | todo |
| Role custom por tenant | Admin edita `role_permissions` ou cria role custom (ex: `contador_externo`) | todas | 01b | todo |
| Grants diretos (`user_permissions`) | Exceção pontual user → permission com `expires_at` e `reason` | todas | 01b | todo |
| Consent LGPD | Consentimentos cross-module/cross-company granulares | todas | 01b | todo |
| `franchise_agreements` | Pares bilaterais para cross-company em `topology=franchise` | todas | 01b | todo |
| Audit log | Append-only, particionado por mês, leitura sensível grava sempre | todas | 01b | todo |
| Observabilidade | Sentry + PostHog + Logtail/Axiom | todas | 00 | todo |
| CI + teste RLS | Pipeline GitHub Actions que falha se tabela nova sem RLS | todas | 00 | todo |

---

## Geral

Módulos que servem todas as verticais. Extensões específicas (ex: "modalidades de Academia" em cima da agenda universal) moram na área da vertical.

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Cadastro de pessoa (`members`) | Perfil único cross-module do aluno/paciente, com `home_unit_id` | Academia, Fisio, Nutri | 02 | todo |
| Timeline do member (`member_events`) | Histórico append-only cross-module | Academia, Fisio, Nutri | 02 | todo |
| Tags e anotações livres | Classificação + notas rápidas por operador | Academia, Fisio, Nutri | 02 | todo |
| Recursos agendáveis | Instrutor, sala, equipamento (`resources`) | Academia, Fisio, Nutri | 03 | todo |
| Slots recorrentes | Geração lazy de slots semanais/diários | Academia, Fisio, Nutri | 03 | todo |
| Agendamentos + waitlist | Booking, cancelamento, lista de espera, check-in manual | Academia, Fisio, Nutri | 03 | todo |
| Planos (ofertas comerciais) | Catálogo de planos do tenant | Academia, Fisio, Nutri | 04 | todo |
| Contratos (member ↔ plano) | Matrícula com vigência e ciclo de renovação | Academia, Fisio, Nutri | 04 | todo |
| Cobranças Asaas | Boleto, Pix, cartão recorrente; chave por company ou por tenant (ADR 0010) | Academia, Fisio, Nutri | 04 | todo |
| Webhooks idempotentes | Recepção HMAC de eventos externos (`webhook_events.external_id`) | Academia, Fisio, Nutri | 04 | todo |
| Promoções (cupons) | Códigos com tipo/validade/teto/planos aplicáveis | Academia, Fisio, Nutri | 05 | todo |
| Pacotes (bundles) + créditos | Plan composto + `appointment_credits` consumidos na agenda | Academia, Fisio, Nutri | 05 | todo |
| Referrals (indicação premiada) | Código de indicação → desconto no referred + recompensa no referrer | Academia, Fisio, Nutri | 05 | todo |
| Cashback (stretch) | Ledger de pontos/créditos ganhos por pagamento | Academia, Fisio, Nutri | 05 (stretch) | todo |
| Copilot chat (IA) | Chat ancorado em contexto do member; consulta/sugestão, nunca prescrição | Academia, Fisio, Nutri | 06 | todo |
| Cache semântico + rate-limit | `ai_cache` (pgvector) + Upstash Redis por tenant | Academia, Fisio, Nutri | 06 | todo |
| Dashboard "Equilíbrio Vital" | Home por role (recepção/gerente/diretor) + KPIs do negócio + tokens light/dark sem sombra | Academia, Fisio, Nutri | 07 | todo |
| Dashboard do member | Home `/app/members/[id]` com widgets contribuídos por cada módulo (timeline, agenda, financeiro, copilot, acessos, créditos, conquistas, metas) | Academia, Fisio, Nutri | 02 (layout) + 03/04/05/06/08/09 (widgets) | todo |
| Cross-alert dispatcher | Publisher/subscriber em cima de `domain_events` (consumidores reais nascem na Fase 2 e no Sprint 09) | todas | 07 | todo |
| Conquistas (gamification leve) | Catálogo configurável + regras declarativas que consomem `domain_events` | Academia, Fisio, Nutri | 09 | todo |
| Brindes (reward catalog + grants) | Físico (camiseta), digital_credit (crédito na próxima) ou service_credit (1 PT de cortesia) com workflow de entrega | Academia, Fisio, Nutri | 09 | todo |
| Metas + progresso automático | Objetivos do member (perder 5kg, 3×/sem); progresso vindo de antropometria, check-ins, medição manual | Academia, Fisio, Nutri | 09 | todo |
| Top performers (stretch) | Card de ranking no dashboard geral com opt-in do member | Academia, Fisio, Nutri | 09 (stretch) | todo |
| Funil de vendas (`leads`) | Estágios configuráveis, aula experimental, propostas versionadas, conversão → member | Academia, Fisio, Nutri | 10 | todo |
| Propostas comerciais | Documento versionado com plano/bundle + desconto + validade | Academia, Fisio, Nutri | 10 | todo |
| Biblioteca de exercícios | Catálogo global + tenant com vídeos curtos em Storage | Academia, Fisio (reabilitação) | 11 | todo |
| Workouts (treinos) | Conjunto ordenado de exercícios com séries/reps/carga/descanso; versionado | Academia, Fisio | 11 | todo |
| Prescrições polimórficas | `prescriptions` com `kind` (workout / meal_plan / fisio_protocol); genérico | Academia, Fisio, Nutri | 11 | todo |
| Execução de sessão + RPE | Registro de performance real + percepção de esforço 1–10 | Academia, Fisio | 11 | todo |
| Avaliações físicas (catálogo) | Tipos configuráveis (bioimpedância, dobras, anamnese, ROM) com campos declarativos | Academia, Fisio, Nutri | 12 | todo |
| Registro seriado de medições | `measurements` séries temporais + gráficos de evolução | Academia, Fisio, Nutri | 12 | todo |
| Anamnese estruturada | Template de formulário com perguntas abertas/múltipla escolha | Academia, Fisio, Nutri | 12 | todo |
| Calculadoras (IMC, Pollock, TMB) | Funções derivadas das medições | Academia, Nutri | 12 | todo |
| Integração WhatsApp | Provider abstrato (Twilio / Z-API / Meta via ADR 0025) + templates | Academia, Fisio, Nutri | 13 | todo |
| Integração email (Resend) | Canal alternativo/redundante consolidado | Academia, Fisio, Nutri | 13 | todo |
| Régua de cobrança (DSL) | Motor declarativo: evento → ação → delay (cobrança, reengajamento, follow-up lead) | Academia, Fisio, Nutri | 13 | todo |
| Opt-out e rate-limit | Consent de marketing + limite por tenant | Academia, Fisio, Nutri | 13 | todo |
| Custos operacionais | `cost_categories` (fixos/variáveis) + `cost_entries` + recorrências | Academia, Fisio, Nutri | 14 | todo |
| DRE consolidado | Receita - custos por período/company/tenant + export PDF/CSV | Academia, Fisio, Nutri | 14 | todo |
| Previsibilidade de receita | Projeção 3 meses + simulador de sensibilidade | Academia, Fisio, Nutri | 14 | todo |
| Pipeline de features de churn | Extração por member de `domain_events` (frequência, pagamento, engajamento) | Academia, Fisio, Nutri | 15 | todo |
| Modelo preditivo de churn | `prob_30d/60d/90d` + top factors + modelo via ADR 0027 | Academia, Fisio, Nutri | 15 | todo |
| Intervenções de retenção | `churn_interventions` + integração com régua de cobrança para ação automática | Academia, Fisio, Nutri | 15 | todo |
| Feedback loop de cancelamento | `churn_events` alimenta retreino + mede accuracy | Academia, Fisio, Nutri | 15 | todo |

---

## Academia

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Modalidades de Academia | Musculação, aula coletiva, personal — extensão de `resources`/`slots` | Academia | 03 (embutido) | todo |
| QR code do aluno + HMAC rotativo | Token rotativo 60s para check-in; antifraude contra screenshot | Academia | 08 | todo |
| Catraca + Realtime | Hardware + canal `tenant:X:unit:Y:access` para UI recepção ao vivo | Academia | 08 | todo |
| Check-in/out (`access_events`) | Append-only de passagens na catraca | Academia | 08 | todo |
| Bloqueio por inadimplência (`access_blocks`) | Bloqueia QR quando contrato está em atraso X dias | Academia | 08 | todo |

**Fora do MVP (mapeado):** offline-first da catraca — check-in local grava e sincroniza depois. Vira sprint na Fase 2 se requisito duro aparecer.

---

## Fisio (Fase 2 — alto-nível)

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Prontuário eletrônico | Documentos clínicos por consulta, criptografados at-rest | Fisio | 16 | futuro |
| Assinatura digital ICP-Brasil | Assinatura do prontuário pelo profissional (CFM/CREFITO) | Fisio | 16 | futuro |
| Evolução com mídias | Fotos/vídeos em Supabase Storage criptografado | Fisio | 17 | futuro |
| Cross-alert lesão→treino | Consumidor de `domain_events` do Sprint 07 + ação automática no Academia (com consent) | Fisio + Academia | 18 | futuro |
| Generative UI (cards de relatório) | Resposta IA renderiza componentes, não texto corrido | Fisio (primeira) | 19 | futuro |

---

## Nutri (Fase 3 — alto-nível)

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| Antropometria (subtipo de avaliação) | Reusa `assessment_types` do Sprint 12 com template Nutri; cardápios herdam do member | Nutri | 20 | futuro |
| Cardápios | Planos alimentares diários/semanais com lista de substituições (reusa `prescriptions` polimórficas do Sprint 11) | Nutri | 20 | futuro |
| Nutri-Agent (IA) | Agente IA cruzando log de Academia + prontuário Fisio (sempre com consent ativo) | Nutri | 21 | futuro |

---

## Módulos transversais além do MVP

| Módulo | Descrição | Verticais | Sprint | Status |
|---|---|---|---|---|
| App nativo Expo | Aluno/paciente mobile; PWA cobre 90% no MVP | todas | 22 | futuro |
| Módulo fiscal (Focus NFe) | Emissão de NFS-e por company | todas | 23 | futuro |
| Prescrição adaptativa IA por RPE | Consome `workout_sessions.rpe` do Sprint 11 + ajusta carga automaticamente | Academia | pós-22 | futuro (depende de app nativo) |

---

## Dashboard do member — modelo de visibilidade de widgets

A home `/app/members/[id]` é um **grid de widgets** contribuídos por cada sprint. Cada widget é registrado com metadados e o componente `<MemberWidgetSlot />` filtra por 3 gates antes de renderizar:

```ts
registerMemberWidget({
  slot: 'financeiro',
  component: FinanceiroWidget,
  requiredPermissions: ['financeiro.read'],  // role gate via RBAC (camada 3)
  requiredVertical: null,                    // vertical gate; null = qualquer
  consentPurpose: null,                      // consent gate (camada 4); null = não precisa
  showWhen: (member) => boolean,             // presença: só renderiza se condição é true (ex: tem dado)
})
```

### As 3 gates

1. **Role gate** — `requiredPermissions` bate contra os `scopes[]` do JWT. Se o user não tem a permission, widget some.
2. **Vertical gate** — `requiredVertical` checa se o tenant tem a vertical ativa (ex: `fisio`). Widget de Fisio não aparece em tenant só-Academia.
3. **Presença** — `showWhen(member)` roda query/flag: widget só aparece se faz sentido para este member (ex: widget "prontuário" só se existe ao menos 1 consulta fisio).
4. **Consent gate** — `consentPurpose` exige `consents` ativo do `member` quando o widget é **cross-module** (ex: instrutor Academia vendo lesão Fisio).

### Matriz de visibilidade (MVP + previsão Fase 2/3)

| Widget | Slot | Permission | Vertical | Presença | Consent? | Roles que veem |
|---|---|---|---|---|---|---|
| Dados + timeline resumida | `overview` | `member.read` | — | sempre | não | todos com acesso ao member |
| Agenda do paciente | `agenda` | `agenda.read` | — | member tem `appointments` | não | recepção, gerente, instrutor, fisio, nutri |
| Financeiro do paciente | `financeiro` | `financeiro.read` | — | member tem `contracts` ativo ou histórico | não | recepção, gerente, diretor |
| Copilot (CTA contextual) | `copilot` | `copilot.use` | — | sempre | não | recepção, gerente, fisio, nutri, instrutor |
| Créditos ativos | `creditos` | `member.read` | — | member tem `appointment_credits.balance > 0` | não | recepção, gerente, fisio, nutri, instrutor |
| Acessos (Academia) | `acessos` | `acesso.read` | `academia` | member tem `access_events` | não | recepção, gerente, instrutor |
| Treino atual | `treino` | `prescricao.read` | — | member tem `workout_prescriptions` ativo | não | instrutor, fisio, gerente |
| Última avaliação | `avaliacao` | `avaliacao.read` | — | member tem `assessments` | não para profissional direto; **sim** cross-module | profissional do tipo relevante (Academia/Fisio/Nutri) |
| Conquistas | `conquistas` | `engajamento.read` | — | sempre (mostra progresso mesmo sem earned) | não | recepção, gerente, fisio, nutri, instrutor |
| Metas | `metas` | `engajamento.read` | — | member tem `goals` ativos | não | recepção, gerente, fisio, nutri, instrutor |
| Risco de churn | `risco` | `retencao.read` | — | `last_prediction_prob_30d > 0.3` | não | gerente, diretor (não aluno nem instrutor) |
| Prontuário (Fisio, Fase 2) | `prontuario` | `prontuario.read` | `fisio` | member tem `consultas` fisio | não para fisio; **sim** para cross-module | fisio (direto), instrutor (se consent `injury_to_training`) |
| Evolução com mídias (Fisio, Fase 2) | `evolucao` | `prontuario.read` | `fisio` | member tem `evolucao_entries` | não | fisio |
| Antropometria (Nutri, Fase 3) | `antropometria` | `nutri.read` | `nutri` | member tem `antropometria_entries` | não para nutri; **sim** cross-module | nutri (direto), fisio (se consent) |
| Plano alimentar (Nutri, Fase 3) | `alimentar` | `nutri.read` | `nutri` | member tem `cardapios` ativo | não para nutri; sim cross-module | nutri |

### Exceções de role

- **Group_owner** nunca vê widgets individuais do member — permanece em views agregadas do grupo (regra 26). Se entrar em um tenant específico com role explícito, vê conforme role.
- **Aluno/paciente (futuro app)** vê os próprios widgets: `overview`, `agenda` (seus agendamentos), `financeiro` (suas cobranças), `acessos` (seus check-ins).
- **Dado clínico nunca cruza `company_id`** em `topology=franchise` (regra 25) — widget some mesmo com consent quando a regra 25 se aplica.

### Registro dos widgets

- Registro acontece no boot da app (Sprint 02 cria `packages/ui/members/registry.ts`).
- Cada sprint adiciona 1 call `registerMemberWidget(...)` durante seu próprio setup.
- Testes e2e garantem que widget fantasma (sem permission/vertical) não aparece.

---

## Convenções

- **Um módulo pertence a uma área dominante**, mesmo que seja usado por outras. Ex: "modalidades de Academia" é área `academia` apesar de ser extensão de módulos `geral`.
- **Módulos cross-vertical ficam em `geral`** (ver [ADR 0003](decisions/0003-escopo-mvp-uma-vertical.md) sobre a decisão de vertical única no MVP + motor cross).
- **Status espelha o sprint alvo** — se o sprint alvo está `todo`, todos os módulos dele estão `todo`. Quando sprint vira `doing`/`done`, os módulos seguem junto.
- **Módulos `futuro`** são speculative — podem ser divididos, renomeados ou absorvidos quando chegar a hora. Este catálogo não é promessa, é mapa.

---

## Referências

- [`roadmap.md`](roadmap.md) — linha do tempo e controle de evolução por sprint
- [`sprints/`](sprints/) — plano executável de cada sprint
- [`arquitetura.md`](arquitetura.md) — stack e camadas
- [`rules.md`](rules.md) — regras que todo módulo respeita
- [`multiempresa.md`](multiempresa.md) — scopes onde cada módulo opera
- [`decisions/`](decisions/) — ADRs citadas aqui
