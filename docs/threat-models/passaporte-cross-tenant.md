# Threat Model STRIDE — Passaporte cross-tenant do paciente

> **Stub** — Threat model esperado para a feature de passaporte cross-tenant ([ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) + regra 42), implementada a partir de [Sprint 02](../sprints/02-geral-crm-pessoas.md). Será expandido durante implementação. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Passaporte do paciente cross-tenant (vínculo `patient_company_links` + `patient_link_modules` + leituras agregadas via `has_cross_tenant_access()`)
- **Sprint:** 02 (schema + fluxo) + 26 (portal paciente — visibilidade)
- **Data:** stub criado em 2026-04-25
- **ADR de referência:** ADR 0077

## Diagrama de fluxo (a expandir)

```
[Profissional Tenant A]                                      [Paciente]
        │                                                         │
        │ 1. cria invite (patient_company_links pending)          │
        │ 2. WhatsApp/email com magic link                        │
        ├────────────────────────────────────────────────────────►│
        │                                                         │ 3. clica → branch CPF
        │                                                         │    (login OU cadastro)
        │                                                         │ 4. aceita parcial/total
        ◄─────────────────────────────────────────────────────────┤
        │ 5. patient_link_modules ativado                         │
        │                                                         │
        │ 6. leitura cross-tenant via                             │
        │    has_cross_tenant_access() + log síncrono             │
        │    (patient_data_access_log — regra 42)                 │
```

## Análise STRIDE (a expandir antes da Sprint 02 entrar em `doing`)

| Ameaça | Cenário-chave a investigar |
|---|---|
| **S**poofing | Atacante intercepta invite link e aceita como se fosse o paciente real |
| **T**ampering | Profissional malicioso edita `patient_link_modules.granted` direto no DB para ler sem consent |
| **R**epudiation | Paciente nega ter aceito vínculo após dado já ter sido lido |
| **I**nformation disclosure | Server Action lê tabela clínica de outro tenant sem chamar `has_cross_tenant_access()` (lint `cross-tenant-read-must-log` mitiga) |
| **D**enial of service | Bombardeio de invites para CPFs aleatórios (rate limit por tenant 50/dia + por CPF 3/30d — pergunta aberta no Sprint 02) |
| **E**levation of privilege | Member ativa o passaporte com role mais permissiva que pretendido pelo profissional |

## Áreas críticas que o threat model expandido precisa cobrir

- Branch automático CPF existe vs novo (Sprint 02:24) — race condition entre cadastro proativo e invite reativo
- Substituição de vínculo do mesmo módulo (`revoked_at`) — paciente confirma; o que se atacante automatiza a substituição?
- Limites duros que **nunca** cruzam: financeiro, Nível 5 (notas privadas), prontuário CFM original, dado de terceiros
- Auditoria síncrona não-bloqueante de `patient_data_access_log` — falha em gravar log deve abortar leitura?
- Cobrança: 1 active member por (paciente, tenant) — manipulação de vínculo cria/destrói member?

## Referências

- [ADR 0077 — Passaporte cross-tenant](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)
- [RIPD v1.0-passaporte-paciente.md](../compliance/ripd/v1.0-passaporte-paciente.md)
- [Regra 42 em rules.md](../rules.md)
