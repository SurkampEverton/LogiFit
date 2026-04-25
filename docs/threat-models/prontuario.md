# Threat Model STRIDE — Prontuário (assinatura + leitura cross-role)

> **v0.1-skeleton** — STRIDE obrigatório (regras 39, 42, 43 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)). Substância completa quando [Sprint 20](../sprints/20-fisio-prontuario-cid-cif.md) implementar prontuário fisio + signature_policies.

- **Feature:** Prontuário eletrônico — criação, edição, assinatura (`signature_policies` por kind: ICP-Brasil para CFM/médicos; authenticated_lock+audit_chain para CREFITO/CFN), leitura cross-role e cross-tenant via passaporte
- **Sprint:** [Sprint 20 — Fisio prontuário CID/CIF](../sprints/20-fisio-prontuario-cid-cif.md) (e similares para nutri/médico)
- **Data:** 2026-04-25 (skeleton)
- **Autor:** Fundador
- **Próxima revisão:** quando feature em produção + a cada mudança de `signature_policies`

## Diagrama de fluxo de dados (a expandir Sprint 20)

```
[Profissional fisio/médico/nutri]
   ↓ (login + MFA obrigatório regra 43)
[Server Action /actions/prontuario.* (wrapAction)]
   ↓ (gate: profissional com conselho ativo + permission por kind)
[INSERT/UPDATE prontuario_evolucao (RLS por tenant_id)]
   ↓ (BEFORE INSERT trigger: hash_chain regra 39)
[audit_log (hash chain + WORM anchor 1h)]
   ↓ (signature gate: signature_policies)
[ICP-Brasil signature service (médico CFM)] OR [authenticated_lock (fisio/nutri)]
```

**Trust boundaries:**
1. Profissional → Server Action — auth + MFA + role check + conselho ativo
2. Server Action → DB — Drizzle param binding + RLS + signature gate
3. Server Action → ICP-Brasil signer (provider externo) — safeFetch allowedHosts (regra 37)
4. Cross-tenant read (passaporte) — `has_cross_tenant_access()` SQL function (regra 42)

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing | Atacante usa sessão de profissional que esqueceu logout | MFA recente <15min para assinatura (regra 43) + timeout sessão + audit por dispositivo | 🟡 a implementar Sprint 20 |
| **S**poofing | Profissional sem conselho ativo finge ser fisio/médico | Gate `professional_registrations.situation='ativo'` + verificação periódica via portal CFM/CREFITO (Fase 2; MVP é `operator_attested`) | 🟡 a implementar |
| **T**ampering | Atacante modifica evolução já assinada | Hash chain detecta modificação posterior (regra 39); UI bloqueia edição pós-assinatura; emenda gera nova evolução vinculada | 🟡 a implementar |
| **T**ampering | Manipulação de PDF de prontuário exportado | PDF exportado tem hash + timestamp + assinatura (ICP se médico); reimport valida | 🟡 a implementar |
| **R**epudiation | Profissional nega ter assinado evolução | Hash chain `audit_log` + assinatura ICP-Brasil para CFM (CFM 2.299) + authenticated_lock+audit chain para fisio/nutri (COFFITO 414, CFN 599) | 🟡 a implementar |
| **R**epudiation | Tenant nega que evolução X existe | `audit_log` hash chain ligado a WORM Object Lock; quebra é detectada por job semanal + dispara alert critical | 🟢 padrão definido (regra 39) |
| **I**nformation disclosure | Tenant A lê prontuário de tenant B | RLS multi-tenant + lint cross-tenant-read-must-log (regra 42); cross-tenant via passaporte entrega **resumo**, não bruto | 🟢 padrão definido (regras 1, 42) |
| **I**nformation disclosure | Recepcionista lê prontuário (não-clínico) | Permission `prontuario.read.full` apenas em roles clínicas; recepção tem `prontuario.read.summary` (data + profissional + status) | 🟡 a implementar |
| **I**nformation disclosure | Vazamento de prontuário cifrado at-rest comprometido | AES-256-GCM por campo + KEK por tenant; backup cifrado GPG separado da KEK (regra 40) | 🟢 padrão definido |
| **D**enial of service | ICP-Brasil signer cai → assinaturas não fluem | Queue persistente + retry; profissional vê banner "assinatura pendente — recoverable em 24h"; runbook de fallback se >24h | 🟡 a implementar |
| **E**levation of privilege | Profissional acessa prontuário de paciente que não atende | RBAC + `member_professional_links` valida; lint `cross-professional-read-must-log` se vai virar | 🟡 a implementar |
| **E**levation of privilege | IA assistente Camada 3 chama `signEvolution` | **BLOQUEADO** em MVP (regra 41 + ADR 0075) — assinatura é write proibido para IA | 🟢 política definida |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Profissional autêntico mente sobre conteúdo da evolução | LogiFit não pode validar verdade clínica | Hash chain garante não-repudiação do que foi escrito; veracidade é responsabilidade legal do profissional + conselho |
| ICP-Brasil cert vencido permite assinatura inválida | Cert é responsabilidade do médico | UI alerta D-30, D-15, D-7; recusa assinar com cert expirado |
| Cross-tenant resumo "vaza" via reanálise (atacante combina múltiplos resumos) | Inerente a passaporte | RIPD passaporte aceita explicitamente (parecer DPO seção 8); auditoria trimestral de leituras anormais |

## Plano de revisão

- Próxima revisão obrigatória: **antes de production launch (Sprint 20)** + semestral
- Revisar antes de:
  - [ ] Adicionar prontuário médico (CFM 2.299 → ICP-Brasil obrigatório)
  - [ ] Adicionar prontuário nutri (Sprint 31)
  - [ ] Habilitar passaporte clínico cross-tenant em produção
  - [ ] Mudança em `signature_policies`

## Referências

- [Sprint 20](../sprints/20-fisio-prontuario-cid-cif.md)
- ADR 0032 (esperado, Sprint 20) — `signature_policies`
- [ADR 0077 — Passaporte cross-tenant](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)
- [regra 39 — hash chain em rules.md](../rules.md)
- [regra 42 — passaporte cross-tenant em rules.md](../rules.md)
- [regra 43 — MFA em rules.md](../rules.md)
- Lei 13.787/2018 + CFM 2.299/2021 + COFFITO 414+415/2012 + CFN 599/2018
