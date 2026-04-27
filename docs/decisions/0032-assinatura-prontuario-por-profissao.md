# ADR 0032 — Assinatura de prontuário com política por profissão (`signature_policies`)

- **Status:** Accepted
- **Date:** 2026-04-27

## Context

LogiFit fecha prontuário eletrônico para 4 profissões reguladas com **regimes legais distintos** quanto ao requisito de assinatura digital:

| Profissão | Conselho | Norma | ICP-Brasil obrigatório? |
|---|---|---|---|
| Médico | CFM (Lei 3.268/1957) | **CFM 2.299/2021** | **Sim** — assinatura ICP-Brasil obrigatória |
| Fisioterapeuta | COFFITO/CREFITO (Lei 6.316/1975) | **COFFITO 414/2012 + 415/2012** | Opcional, **se** houver sistema autenticado + trilha de auditoria + hash chain |
| Nutricionista | CFN/CRN (Lei 6.583/1978) | **CFN 599/2018** | Não obrigatório, **se** houver autenticação + trilha |
| Educador físico / personal | CONFEF/CREF (Lei 9.696/1998) | Diretrizes CONFEF | Não obrigatório (atividade não-clínica majoritária) |

Lei federal **13.787/2018** estabelece retenção mínima de **20 anos** do prontuário eletrônico, independente da profissão — norma primária sobre o tema.

CLAUDE.md (root) já documenta o gate semântico:

```
if profissional.kind === 'medico' → require_icp_brasil_signature
else if kind in ['fisio','nutri','personal'] → require_authenticated_lock_with_audit_chain
```

A regra está mencionada em [Sprint 20](../sprints/20-fisio-prontuario-cid-cif.md), [Sprint 25](../sprints/25-fisio-anvisa-cnes.md) e nos threat models de [`prontuario.md`](../threat-models/prontuario.md), porém **sem ADR formal** que padronize a tabela, o wrapper e o fluxo de fallback. Faltava também responder: o que acontece quando profissional médico assina **sem** certificado válido? Como tenant configura preferências mais restritivas? Como muda regime quando profissional troca de conselho?

## Decision

Adotar uma **política de assinatura tabulada**, configurável por profissão e por tenant, com 4 componentes:

### 1. Tabela `signature_policies` (catálogo global LogiFit)

Catálogo padrão mantido pela LogiFit (não editável por tenant), seedado por migration:

```sql
CREATE TABLE signature_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profession text NOT NULL UNIQUE,            -- 'medico' | 'fisio' | 'nutri' | 'personal' | 'enfermeiro'
  mode text NOT NULL,                          -- 'icp_required' | 'authenticated_lock' | 'icp_optional'
  min_cert_level text,                         -- 'A1' | 'A3' | NULL (não-aplicável)
  requires_mfa boolean NOT NULL DEFAULT true,  -- regra 43 — MFA recente <15min
  requires_audit_chain boolean NOT NULL DEFAULT true,  -- regra 39 — hash chain audit_log
  requires_authenticated_session boolean NOT NULL DEFAULT true,
  source_norm text NOT NULL,                   -- 'CFM 2.299/2021', 'COFFITO 414/2012', etc
  retention_years integer NOT NULL DEFAULT 20, -- Lei 13.787/2018
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Seed inicial (Sprint 01b):

| profession | mode | min_cert_level | requires_mfa | requires_audit_chain | source_norm |
|---|---|---|---|---|---|
| `medico` | `icp_required` | `A3` | true | true | CFM 2.299/2021 |
| `fisio` | `authenticated_lock` | NULL | true | true | COFFITO 414/2012 + 415/2012 |
| `nutri` | `authenticated_lock` | NULL | true | true | CFN 599/2018 |
| `personal` | `authenticated_lock` | NULL | true | true | Lei 9.696/1998 + diretriz CONFEF |
| `enfermeiro` | `icp_optional` | `A1` | true | true | COFEN 358/2009 (futuro — Fase 3) |

`min_cert_level=A3` para médico segue recomendação CFM (token criptográfico ou cartão); `A1` é apenas para fluxos de upgrade/transição.

### 2. Tabela `tenant_signature_overrides` (escalada por tenant — restrição apenas)

Tenant Enterprise pode **endurecer** a política (nunca relaxar). Ex: rede hospitalar exige ICP-Brasil também para fisioterapeutas:

```sql
CREATE TABLE tenant_signature_overrides (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  profession text NOT NULL,
  mode_override text NOT NULL,        -- só aceita 'icp_required' acima do baseline
  reason text NOT NULL,               -- justificativa registrada
  approved_by uuid NOT NULL REFERENCES users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profession),
  CHECK (mode_override = 'icp_required')  -- só permite endurecer
);
```

Validação CI: lint `signature-override-only-stricter` rejeita override que afrouxe baseline.

### 3. Wrapper `requireSignaturePolicy(consultaId, professionalId)`

Server Action de fechamento de prontuário (`closeConsulta`, `signEvolution`) sempre passa por:

```ts
async function requireSignaturePolicy(consultaId, professionalId, ctx) {
  const prof = await getProfessional(professionalId);
  const policy = await getEffectiveSignaturePolicy(prof.kind, ctx.tenantId);

  // 1. MFA recente (regra 43)
  if (policy.requires_mfa && !ctx.mfaRecent(15 * 60))
    throw new SignaturePolicyViolation('MFA_REQUIRED');

  // 2. Conselho ativo (ADR 0055 — professional_registrations)
  const reg = await getActiveRegistration(professionalId, prof.kind);
  if (!reg || reg.status !== 'active')
    throw new SignaturePolicyViolation('PROFESSIONAL_REGISTRATION_INACTIVE');

  // 3. Modo de assinatura
  switch (policy.mode) {
    case 'icp_required':
      const cert = await ctx.icpBrasilCertificate();
      if (!cert || cert.level < policy.min_cert_level)
        throw new SignaturePolicyViolation('ICP_BRASIL_REQUIRED');
      return { mode: 'icp_brasil', certHash: sha256(cert), serial: cert.serial };

    case 'authenticated_lock':
      // sessão autenticada + MFA recente já validados acima
      return { mode: 'authenticated_lock', sessionId: ctx.sessionId };

    case 'icp_optional':
      const optionalCert = await ctx.icpBrasilCertificate({ optional: true });
      return optionalCert
        ? { mode: 'icp_brasil', certHash: sha256(optionalCert), serial: optionalCert.serial }
        : { mode: 'authenticated_lock', sessionId: ctx.sessionId };
  }
}
```

Resultado é gravado na tabela `consulta_signatures (consulta_id, professional_id, mode, cert_hash, serial, signed_at, audit_log_id)` com FK para `audit_log` (mantém hash chain — regra 39).

### 4. Fluxo ICP-Brasil — provider abstrato

ICP-Brasil é integrado via **provider abstrato** (mesmo padrão do ADR 0035 OCR e ADR 0048 CNPJ):

```ts
interface ICPBrasilProvider {
  signDocument(payload: Buffer, certThumbprint: string): Promise<SignedPayload>;
  verifyCertificate(thumbprint: string): Promise<{ valid: boolean; level: 'A1' | 'A3'; expiresAt: Date }>;
}
```

Providers candidatos (POC na Sprint 20):
- **BirdID Soluti** — token mobile A3, API REST simples
- **VaultID** — assinatura em nuvem A3, integração mais barata
- **VidaaS / Bry** — alternativas

Decisão final do provider em **ADR de submissão** durante Sprint 20 (não bloqueia este ADR).

## Consequences

### Positivas

- **Conformidade tripla:** CFM 2.299, COFFITO 414/415, CFN 599 cobertas com regime correto sem código duplicado.
- **Tenant Enterprise pode endurecer** sem precisar fork de código (rede hospitalar exigir ICP em todos os profissionais é só 1 INSERT na `tenant_signature_overrides`).
- **Audit chain (regra 39) integrada** — assinatura grava em `audit_log` ligando a hash chain, atende COFFITO 414 (autenticidade + integridade) e CFM 2.299 (rastreabilidade).
- **Catálogo extensível** — adicionar enfermagem (COFEN 358/2009), psicologia (CRP), odontologia (CRO) é apenas seed novo + integração de conselho (ADR 0055).

### Negativas (mitigáveis)

- **Wrapper `requireSignaturePolicy`** adiciona ~200ms de latência (verificação certificado + MFA recente). Mitigação: cache 15min de validação certificado por sessão.
- **Provider ICP-Brasil tem custo** (~R$ 5-15 por assinatura) — repassar via overage ou incluir no plano? **Decisão:** ICP-Brasil só ativa quando tenant tem Plano Pro+ com vertical Fisio/Médica; Solo/Starter sem vertical regulada não vê custo. Escopo: ADR 0066 já permite repasse via overage.
- **Token físico A3** exige hardware no dispositivo do médico — UX ruim em consultório com vários médicos compartilhando computador. Mitigação: integração via assinatura em nuvem (VaultID) elimina hardware local.

### Riscos não endereçados

- **CFM publicar resolução nova** flexibilizando ICP — pouco provável (CFM 2.299 é recente e estrita); se ocorrer, atualizar seed `signature_policies.medico.mode='icp_optional'` via migration.
- **COFFITO endurecer** exigindo ICP-Brasil — endereçar com migration que muda `fisio.mode='icp_required'`; tenant tem **90 dias** para adquirir certificados (banner + email); medical-grade fallback `authenticated_lock` durante transição.
- **Profissional médico sem certificado em emergência** — bypass possível? **Não.** Política CFM 2.299 não permite. UX deve oferecer "salvar rascunho" (não-fechado) e fechar depois com certificado.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Hardcode `if kind === 'medico'` no código | Inflexível para Enterprise endurecer; mistura regra de negócio com infra |
| ICP-Brasil obrigatório para todos | Custo operacional alto + sem base legal para fisio/nutri/personal; barreira de entrada |
| Apenas autenticação simples (sem MFA recente <15min) | Viola regra 43; CFM 2.299 exige autenticação forte |
| Tabela editável pelo tenant sem restrição | Tenant pode afrouxar abaixo do baseline legal; risco regulatório transferido |
| Assinatura via SHA-256 manual sem ICP-Brasil para médico | Não atende CFM 2.299 — "obrigatória ICP-Brasil"; risco de invalidação do prontuário |

## Escopo de impacto

- **Sprint 01b (RBAC + Consent)** — seed inicial de `signature_policies` com 5 linhas (médico/fisio/nutri/personal/enfermeiro)
- **Sprint 20 (Prontuário CID/CIF)** — implementação completa: wrapper `requireSignaturePolicy`, provider ICP-Brasil escolhido em ADR de submissão, UI de assinatura, tabela `consulta_signatures`
- **Sprint 21 (Evolução + mídias)** — reusa wrapper para fechamento de evolução
- **Sprint 25 (ANVISA + CNES)** — integra `signature_policies` ao fluxo de notificação ANVISA quando aplicável
- **Sprint 31 (Teleconsulta)** — fechamento de teleconsulta médica obriga ICP-Brasil mesmo a distância

## Related

- [ADR 0055 — Registros profissionais em conselho](0055-registros-profissionais-em-conselho.md) — `professional_registrations` com `kind` + status; pré-requisito para `requireSignaturePolicy`
- [ADR 0073 — Defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) — regra 43 (MFA obrigatório) + regra 39 (hash chain)
- [ADR 0072 — Escalabilidade](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — retenção 20 anos do prontuário (Lei 13.787/2018)
- [Threat model — prontuário](../threat-models/prontuario.md) — STRIDE T1 (Spoofing assinatura) mitigado por este ADR
- Fontes legais: [CFM 2.299/2021](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2021/2299), [COFFITO 414/2012](https://www.coffito.gov.br/nsite/?p=3197), [CFN 599/2018](https://www.cfn.org.br/index.php/legislacao/), [Lei 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm), [Lei 9.696/1998](https://www.planalto.gov.br/ccivil_03/leis/l9696.htm)
