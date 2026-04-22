# ADR 0003 — MVP entrega uma vertical (Academia) + motor cross

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

LogiFit tem 3 verticais planejadas (Academia, Fisioterapia, Nutrição) + motor cross-module (CRM, financeiro, agenda, IA). Lançar tudo junto no MVP é receita para atraso em projeto solo. Precisamos priorizar para validar mercado o mais cedo possível.

## Decision

- **MVP (3 meses):** Academia + motor cross (auth, multi-tenancy, RBAC, LGPD consent, CRM unificado, agenda universal, financeiro Asaas, controle de acesso por QR, copilot simples, dashboard).
- **Fase 2 (3–6 meses):** Fisioterapia (prontuário + assinatura ICP-Brasil + evolução com mídia + cross-alert lesão→treino + Generative UI).
- **Fase 3 (6–9 meses):** Nutrição + app nativo (Expo) + módulo fiscal (Focus NFe).
- Multi-tenancy, hierarquia de empresa, RBAC com scope e LGPD **entram desde o MVP** — são fundação, não feature.

## Consequences

- MVP lançável em prazo defensável com time solo.
- Escolher Academia primeiro expõe o modelo de acesso por QR/catraca cedo, validando infraestrutura realtime e offline-first desde cedo.
- Fisioterapia (o requisito mais complexo por conta de prontuário + assinatura + CFM) fica para Fase 2 — ganha tempo para amadurecer decisões de segurança.
- Nutri-IA e app nativo ficam para Fase 3, mas `packages/types` e `packages/ai` são desenhados desde o MVP pensando nesse compartilhamento.
- PWA cobre 90% dos casos no MVP; nativo só entra se surgir necessidade dura antes da Fase 3 (ex: integração Bluetooth com balança, push iOS crítico).
