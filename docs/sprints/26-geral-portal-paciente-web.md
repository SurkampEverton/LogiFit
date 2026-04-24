# Sprint 26 — Geral · Portal do Paciente (Web / PWA)

- **Área:** geral (usado por Academia, Fisio, Nutri — é a primeira interface do aluno/paciente)
- **Início:** planejado (depois do Sprint 25)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #24

## Goal

Portal web self-service do paciente/aluno, entregue como PWA para funcionar como app. Cobre 90% dos casos de uso antes do app nativo da Fase 3 (Sprint 31). Inclui: login próprio, ver dados cadastrais, agenda pessoal, recibos, pagamentos pendentes, vídeos de "lição de casa" (exercícios prescritos), QR code de acesso Academia, cardápio (se Nutri).

## Critério de aceite

- Autenticação separada do operador: magic link por email/SMS para o `member`
- JWT do member tem claim específico `role=member` + `member_id` (RLS protege dados individuais)
- Home contextual por vertical ativa no tenant (Academia / Fisio / Nutri)
- Tela cadastral: ver e editar dados básicos (respeita validação)
- Agenda: próximos agendamentos, botão "cancelar" (respeita política de cancelamento), botão "agendar novo"
- Financeiro: lista de cobranças pendentes + pagar via PIX/cartão direto (reusa Asaas do Sprint 04)
- Recibos: download PDF das últimas cobranças pagas
- Prescrição de exercícios (Academia/Fisio): ficha atual com vídeos via URL assinada, registro de execução + RPE
- Prontuário resumido (Fisio) — só liberado via consent explícito do paciente
- QR Code dinâmico para acesso na catraca (reusa HMAC Sprint 08)
- Portal marca como PWA instalável (manifest + service worker)
- **Responsividade mobile-first total (ADR 0063):** portal usa `<PortalLayout>` do Sprint 00 com **safe-area-inset** respeitado (iPhone notch + home indicator), bottom nav persistente em mobile com 4 ícones principais (Agenda, Financeiro, Treino, Mais); desktop aceito mas é caso secundário (paciente quase sempre no celular); ícone de instalação PWA exibido após 2ª visita via `beforeinstallprompt`; Lighthouse PWA score ≥95
- Testes visuais Playwright em 3 viewports (mobile 390/tablet 768/desktop 1280) cobrindo todas as rotas `/meu/*`
- Teste E2E: member recebe magic link por email → logga → vê agenda → cancela → paga cobrança pendente (rodado em iPhone 13 viewport)
- Teste de instalação PWA: Playwright simula `beforeinstallprompt` → instala → ícone aparece na tela inicial (teste em Chrome/Edge)
- Performance: Lighthouse >90 em mobile (Performance, Accessibility, Best Practices, SEO) + ≥95 em PWA

## Dependências

- Sprint 02 (members)
- Sprint 03 (agenda)
- Sprint 04 (financeiro + cobranças)
- Sprint 05 (créditos)
- Sprint 08 (QR code)
- Sprint 11 (workouts + sessões RPE)
- Sprint 20 (consultas — leitura limitada)
- Sprint 21 (evolução — leitura limitada)

## Decisões tomadas / ADRs esperados

- **ADR 0032 (esperado)** — Autenticação do member: magic link por email/SMS com TTL 15min; JWT com claim `role=member` bloqueia acesso a telas de operador; sessão longa (30d). Separação clara do namespace de role operador.
- **Pergunta aberta:** cancelamento de agendamento — ir direto ou entrar em fila de "cancelamento a aprovar"? Por vertical: Academia (livre até X horas antes), Fisio (aviso ao profissional), Nutri (reagendamento).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Portal do paciente web (PWA)
- Auth do member (magic link)
- Self-service de agenda, financeiro, recibos
- Ficha de exercícios com vídeos
- QR de acesso
- Pagamento via Asaas no portal

## Rotas Next.js

Portal em `/meu/*` (namespace separado do `/app/*`):

- `/meu` — home contextual
- `/meu/perfil` — dados cadastrais
- `/meu/agenda` — próximos + histórico
- `/meu/agenda/novo` — agendar
- `/meu/financeiro` — cobranças pendentes + histórico
- `/meu/financeiro/pagar/[id]` — checkout Asaas
- `/meu/recibos` — download
- `/meu/treino` — ficha atual + vídeos + registro de sessão
- `/meu/qr` — QR code dinâmico com rotação visível
- `/meu/prontuario` — resumo (só Fisio, só se consent explícito)
- `/meu/cardapio` — plano alimentar com PDF (habilitado no Sprint 29 Nutri)
- `/meu/diario` — registro do diário alimentar (habilitado no Sprint 31 Nutri)
- `/meu/teleconsulta/[appointmentId]` — sala de vídeo (habilitado no Sprint 31)
- `/meu/exames` — exames laboratoriais e gráficos de evolução (habilitado no Sprint 30 Nutri)
- `/meu/suplementos` — prescrições ativas de suplementação (habilitado no Sprint 30)
- `/meu/privacidade` (ADR 0054) — portal completo dos 8 direitos LGPD art. 18:
  - **Visão geral:** toggles de consents ativos por finalidade + histórico; revogação imediata é permitida mas **não apaga dados com obrigação de retenção** (prontuário 20 anos CFM 2.299/2021, fiscal 5 anos)
  - **Direito I — Confirmação** (`right='confirmation'`): botão 1-clique → resposta automática
  - **Direito II — Acesso** (`right='access'`): "Baixar meus dados" → admin gera export JSON + PDF em ≤15d → link TTL 7d via email
  - **Direito III — Correção** (`right='rectification'`): form "campo + novo valor sugerido"
  - **Direito IV — Anonimização/eliminação** (`right='anonymization'`): **solicitação, não apagamento automático** — admin + profissional + contador validam em ≤15d o que é apagável (consent não-essencial, marketing, device readings) vs retenção legal; aluno vê resposta na timeline
  - **Direito V — Portabilidade** (`right='portability'`): export JSON + FHIR (clínico) + OFX (financeiro)
  - **Direito VI — Info sobre compartilhamento** (`right='sharing_info'`): lista de terceiros (Asaas, Focus NFe, Garmin, laboratório) + datas + finalidades
  - **Direito VII — Info sobre consequências de não consentir** (`right='consent_info'`): tooltip em cada toggle com impacto ("desativar consent fisio→academia: seu instrutor deixa de ver alertas de lesão")
  - **Direito VIII — Revogação** (`right='revocation'`): toggle na visão geral; cria audit trail
  - **Timeline de solicitações** com status + SLA visível (X dias restantes)
- `/meu/privacidade/solicitacoes/[id]` — detalhe da solicitação + mensagens do admin + anexos
- `/login/meu` — entrada do member (magic link)

**Rotas administrativas espelho (lado operador — admin atende solicitações LGPD):**

- `/app/compliance/titular-requests` (ADR 0054) — fila de `data_subject_requests` com filtros status/tipo/deadline; admin priorize por SLA (D-3 destacado)
- `/app/compliance/titular-requests/[id]` — detalhe: admin revisa pedido, adiciona mensagens ao titular, executa ação (anonimizar conforme matriz de retenção, gerar export, aplicar correção), anexa laudo, marca `fulfilled`/`rejected`
- `/app/settings/retencao` (ADR 0054) — admin vê políticas de retenção legais (prontuário 20a, fiscal 5a, marketing revogável) em `retention_policies`; configuráveis apenas para categorias sem obrigação legal

## Server Actions + API Routes

Server Actions em `apps/web/app/meu/actions.ts`:

- `requestMagicLink(email | phone)` — gera token + dispara email/SMS
- `verifyMagicLink(token)` — cria sessão member
- `cancelMyAppointment(appointmentId)` — respeita política
- `bookMyAppointment(slotId)` — reusa `createAppointment` com `member_id=self`
- `payMyInvoice(invoiceId)` — gera link checkout Asaas
- `recordMyExerciseSession(...)` — reusa Sprint 11

API Routes:

- `POST /api/meu/magic-link` — público; rate-limited
- `POST /api/meu/verify` — verifica token + cria sessão
- `GET /api/meu/qr` — retorna QR atual com rotação

## Schemas Drizzle (esperado)

Minimalista — reusa tudo:

- `member_auth_tokens` — `id`, `member_id`, `token_hash`, `expires_at`, `used_at nullable`, `created_at`, `ip`, `user_agent`. Magic link.
- `member_sessions` — `id`, `member_id`, `refresh_token_hash`, `expires_at`, `device_label`, `last_seen_at`. Multi-dispositivo.

RLS: `member_id = auth.uid() AND auth.jwt() ->> 'role' = 'member'`. Tabelas de domínio (agendas, invoices, etc) já têm RLS; member ganha policy adicional "próprios dados".

## Eventos de domínio emitidos

- `member.portal_login`
- `member.self_cancelled_appointment`
- `member.self_booked_appointment`
- `member.self_paid_invoice`
- `member.self_recorded_session`

## Commit (checklist)

- [ ] Schema Drizzle: `member_auth_tokens`, `member_sessions`
- [ ] Policies RLS adicionais para member em todas as tabelas acessadas (members, appointments, invoices, workouts, consultas, evolucoes, etc)
- [ ] Endpoint magic link com rate-limit + anti-enumeration (resposta idêntica se email existe ou não)
- [ ] Layout `/meu/*` distinto do `/app/*` (sem sidebar operador)
- [ ] Integração Asaas checkout embed
- [ ] Player de vídeo com URL assinada do Sprint 11
- [ ] QR dinâmico reusando HMAC Sprint 08
- [ ] Manifest PWA + service worker + icons
- [ ] Lighthouse CI >90 mobile
- [ ] Cancelamento respeitando política (configurável por tenant)
- [ ] Consent UI: paciente revoga/liga compartilhamento cross-module
- [ ] Testes unit
- [ ] Testes E2E: fluxo magic link → agenda → pagamento → logout
- [ ] Feature flag `portal_member_v1`
- [ ] ADR 0032 publicado

## Stretch

- [ ] Notificação push via PWA (D+1 antes de agendamento)
- [ ] Dark mode respeitando preferência do SO
- [ ] Chat com o profissional (depende de Copilot Sprint 06 estendido; cuidado com limites éticos)
- [ ] Compartilhar evolução (gráfico) com amigos via link público anonimizado

## Log

- —

## Definition of Done

- [ ] Feature flag `portal_member_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Lighthouse mobile >90
- [ ] RLS verificada (member só vê próprios dados)
- [ ] Magic link rate-limited funcional
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 22 → `done`
- [ ] ADR 0032 publicado

## Retro

- —
