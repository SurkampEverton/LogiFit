# ADR 0055 — Registros profissionais em conselho (CRM, CRN, CREFITO, CREF)

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

LogiFit atende profissionais regulados por conselhos federais/regionais de classe:

| Conselho federal | Conselho regional | Profissão | Base legal |
|---|---|---|---|
| **CFM** | **CRM** (por UF) | Médico | Lei 3.268/1957 |
| **COFFITO** | **CREFITO** (por região, 1–21) | Fisioterapeuta / Terapeuta Ocupacional | Lei 6.316/1975 |
| **CFN** | **CRN** (por região, 1–11) | Nutricionista | Lei 6.583/1978 |
| **CONFEF** | **CREF** (por região, 1–25 + DF) | Educador Físico / Personal Trainer | Lei 9.696/1998 |

Até este ADR, o LogiFit só armazenava **profissão genérica** (`medico` / `fisio` / `nutri`) em `signature_policies` (Sprint 20) e identidade pessoal em `persons` (ADR 0047). Nenhuma tabela guarda **número de registro, UF do conselho e situação cadastral** do profissional.

Consequências concretas se não corrigirmos:

1. **Sprint 20 Prontuário não fecha legalmente** — CFM 2.299/2021 art. 3º exige "identificação do profissional contendo nome, número do registro no CRM e UF"; COFFITO 414/2012 art. 7º III idem para CREFITO; CFN 599/2018 art. 5º idem para CRN. Sem o número, o documento assinado (mesmo com ICP-Brasil) é **inválido regulatoriamente**.
2. **Sprint 22 TISS não gera XML válido** — guia TISS 4.01 exige campos `conselhoProfissional`, `numeroConselhoProfissional`, `UF`, `CBOS` (Classificação Brasileira de Ocupações — Saúde). **Sem cadastro a guia é rejeitada pela operadora com glosa estrutural.**
3. **Risco de contratação de profissional cassado/suspenso** — CFM publica lista de cassações; CREFITO e CRN também. Sem cadastro e verificação, tenant pode ter profissional assinando documento enquanto está formalmente suspenso — responsabilidade solidária do tenant e do LogiFit.
4. **Personal trainer sem CREF é prática ilegal** — Lei 9.696/1998 art. 3º obriga registro em CONFEF/CREF para prescrever e orientar exercício físico; tenant de Academia que contrata PT leigo comete infração passível de ação do MP estadual.
5. **LGPD art. 11 fragilizado** — dado de saúde só pode ser tratado por "profissional de saúde" com base legal específica (art. 11 § 4º II); sem cadastro formal da habilitação, não dá para demonstrar o enquadramento ao ANPD.

## Decision

Criar tabela **`professional_registrations`** no **Sprint 01b** (junto com RBAC), gate em sprints clínicos e administrativos críticos.

### Tabela

```sql
professional_registrations
  id uuid pk
  tenant_id uuid not null                        -- RLS
  person_id uuid not null fk persons             -- sempre kind='pf'
  council_body text not null                     -- enum: 'CRM','CRN','CREFITO','CREF','CRF','CRP','COREN','CRO'
  council_number text not null                   -- número bruto
  council_state text not null                    -- UF (SP, RJ, ...) ou região numérica CREFITO/CRN/CREF
  specialty text nullable                        -- opcional: 'ortopedia', 'esportiva', 'clinica', 'pediatrica'
  cbo_code text nullable                         -- Classificação Brasileira de Ocupações (para TISS)
  situation text not null default 'active'       -- enum: 'active','suspended','cassated','expired','pending_verification','unknown'
  issued_at date nullable
  verified_at timestamptz nullable               -- última validação (manual ou automática)
  verified_by_user_id uuid nullable              -- quem atestou (admin do tenant quando MVP manual)
  verification_source text not null default 'operator_attested'  -- enum: 'operator_attested','council_api','council_scraping','document_upload'
  valid_until date nullable                      -- CRP renova bienalmente; CRM/CREFITO sem renovação obrigatória
  document_storage_path text nullable            -- foto/PDF da carteirinha (opcional, audit)
  created_at timestamptz default now()
  updated_at timestamptz
  archived_at timestamptz nullable               -- soft delete (profissional desligou-se)
```

**Constraints:**
- Unique `(council_body, council_number, council_state)` — **global**, não por tenant: o mesmo CRM/SP 12345 do Dr. João não pode ser duplicado entre tenants (detecta fraude de clonagem).
- Check: `persons.kind = 'pf'` quando linkado (validado por trigger — FK composta não cobre).
- Check: `council_body ∈ {'CRM','CRN','CREFITO','CREF','CRF','CRP','COREN','CRO'}` (enum aberto; seed cobre os 4 citados pelo usuário + 4 preparados para futuro).
- Uma pessoa pode ter **N registros** — profissional dual (fisio com CREFITO + educador físico com CREF; médico com CRM em 2 UFs).

**RLS:** padrão do tenant (`tenant_id`). Leitura por qualquer user autenticado do tenant; escrita por permission `profissional.write` (nova, semeada para `super_admin_rede`, `diretor_matriz`, `gerente_filial`).

**Audit:** toda criação/mudança de `situation` ou `verified_at` grava `audit_log` com diff.

### Enum `situation`

| Valor | Significado | Bloqueia assinatura? | Bloqueia TISS? | Bloqueia novo contrato? |
|---|---|---|---|---|
| `active` | Ativo regular | Não | Não | Não |
| `suspended` | Suspenso pelo conselho (temporário) | **Sim** | **Sim** | **Sim** |
| `cassated` | Cassado (perdeu registro) | **Sim** | **Sim** | **Sim** |
| `expired` | Expirou (CRP bienal) | **Sim** | **Sim** | **Sim** |
| `pending_verification` | Cadastrado mas ainda não verificado | Não (grace period 30d) | **Sim** | Não |
| `unknown` | Não conseguimos validar | **Sim** | **Sim** | **Sim** |

### Verificação — faseada

**MVP (Sprint 01b):**
- `verification_source = 'operator_attested'` — admin cadastra manualmente + marca `verified_at` após conferir carteirinha/documento.
- `document_storage_path` opcional (upload de carteirinha em Storage privado).
- Sem integração automática — evita acoplar MVP com scrapers frágeis dos portais dos conselhos.

**Fase 2 (sprint de integração ou pós-19):**
- Job semanal `refresh-professional-situation` tenta validar contra:
  - **CFM** — [portal.cfm.org.br/busca-medicos](https://portal.cfm.org.br/busca-medicos/) (HTML scraping ou API se disponibilizada) → fonte oficial de médicos ativos/suspensos/cassados
  - **CREFITO** — portal nacional ([crefito.com.br](https://www.crefito.com.br/)) com consulta por nome/número
  - **CRN** — portais regionais (CRN-1 a CRN-11) com páginas de consulta pública
  - **CREF** — [cref1.org.br](https://www.cref1.org.br/), [confef.org.br](https://www.confef.org.br/) consulta pública
- Cada provider é uma impl de `CouncilVerifier` interface (padrão provider abstrato, ADR 0048/0050).
- Situação retornada sobrescreve `situation` + grava `verified_at = now()` + `verification_source = 'council_scraping'`.
- Alerta ao admin do tenant quando situação muda para não-ativo.

### Gates aplicados

**Sprint 20 — Assinatura de prontuário:**
- `signConsulta(id)` busca `professional_registrations` WHERE `person_id = consultas.professional_person_id` AND `council_body IN (:kind_to_council_mapping)` AND `situation = 'active'` (ou `pending_verification` + `created_at > now() - 30 days`) → se 0 rows, erro "Profissional não tem registro ativo no conselho X"
- Mapping `kind` → conselho(s) aceitos:
  - `medico` → `CRM`
  - `fisio` → `CREFITO`
  - `nutri` → `CRN`
  - `personal` (stretch) → `CREF`
- XML / PDF do prontuário inclui `{nome} — {conselho}-{UF} {numero}` no rodapé.

**Sprint 22 — Geração de guia TISS:**
- `generateGuide(appointmentId)` preenche XML com `NumeroConselhoProfissional`, `SiglaConselho`, `UF`, `CBOS` (campo `cbo_code` da tabela) do profissional executante
- Se profissional não tem registro `active` + `cbo_code` preenchido → bloqueia com erro "Profissional sem CBOS cadastrado (obrigatório TISS 4.01)"

**Sprint 23 — Contratos de comissão:**
- `createProfessionalContract(personId, ...)` exige 1+ registro ativo coerente com o tipo de atendimento que vai gerar comissão (fisio contract exige CREFITO ativo; personal contract exige CREF ativo etc.)

**Sprint 08 — Personal trainer em Academia (novo gate):**
- Cadastro de profissional com `role='personal'` exige CREF ativo. Validação no onboarding do PT.
- Nota em `docs/comercial.md`: "LogiFit valida CREF de personal trainer no onboarding".

## Consequences

### Positivas

- **Conformidade regulatória legal** com 4 conselhos cobertos + preparação para CRF/CRP/COREN/CRO sem refactor
- **Sprint 20 assina documento válido** com número do conselho no rodapé
- **Sprint 22 TISS gera XML aceitável** — campo obrigatório preenchido automaticamente
- **Auditabilidade reforçada** — ANPD/CFM/CREFITO/CRN fiscalizam com dados prontos
- **Diferencial comercial** — tenants valorizam: "o sistema valida o registro antes de deixar o profissional assinar"
- **Detecção de fraude entre tenants** — mesmo CRM/UF/número em 2 tenants é alerta (constraint global)

### Negativas (mitigáveis)

- **Fricção no onboarding de profissional** — operador precisa coletar número/UF; mitigado por UX que aceita "pending_verification" + grace 30d para não travar primeiro uso
- **Scraping dos portais é frágil** — deixado para Fase 2; MVP assume atestação manual
- **Soft delete complexifica queries** — `WHERE archived_at IS NULL` em toda leitura; centralizado em view `v_professional_registrations_active`
- **Profissional dual** (fisio + PT) gera 2 registros — UX precisa listar todos na mesma pessoa; aceitável

### Riscos não endereçados

- **Dentistas (CRO)** — LogiFit não atende odontologia no MVP, mas enum já prevê para futuro sem migration
- **Enfermeiros (COREN)** — aparece quando tenant tiver clínica médica; preparado
- **Profissional estrangeiro registrado em Brasil** — CFM emite CRM normal após revalidação de diploma; não muda modelo
- **Mudança de UF** — profissional que transfere CRM de SP para RJ: novo registro, arquivar o antigo (soft delete). Sem migration de número.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Campo `council_info text` em `persons` | Não permite múltiplos registros; sem validação estrutural; sem rastro de situação ao longo do tempo |
| Campos em `users` | `users` é só quem tem login; profissional terceirizado que não loga também precisa ter registro (ex: fisio autônomo que presta serviço) |
| Campos em `professional_contracts` | Registro profissional é atributo da **pessoa**, não do contrato; profissional com 3 contratos repetiria dados |
| Validação automática no MVP | Scraping dos portais é frágil; portais mudam HTML; risco de lock-in em fornecedor pago; MVP não precisa |
| Forçar `active` sempre | Não suporta regularização (profissional cadastrado antes da validação de documento; grace period é essencial) |

## Escopo de impacto

**Novo ADR:** este (0055).

**Sprints ajustados:**
- **01b** — cria `professional_registrations` + permissions `profissional.read/write` + UI `/app/pessoas/[id]/registros` + seed dos 4 conselhos base
- **08** — personal trainer contratado exige CREF ativo no onboarding
- **20** — `signConsulta` valida registro ativo do conselho coerente com `kind`; PDF inclui rodapé com conselho-UF-número
- **22** — `generateGuide` popula campos TISS obrigatórios a partir de `professional_registrations` + `cbo_code`; bloqueia se faltar
- **23** — `createProfessionalContract` valida registro ativo antes de criar

**Docs:**
- `docs/modulos.md` — novo módulo transversal "Registro profissional em conselho" (Fundação)
- `docs/rules.md` — nenhuma regra nova (gates ficam nos sprints)
- `CHANGELOG.md` — entrada desta mudança
- `CLAUDE.md` — adicionar ao bloco "Marcos regulatórios": Leis 3.268/1957 (CFM), 6.316/1975 (COFFITO), 6.583/1978 (CFN), 9.696/1998 (CONFEF)

## Related

- Reforça [ADR 0047 — Cadastro central de persons](0047-cadastro-central-persons.md) — profissional é PF cadastrada em persons com 1+ registro profissional linkado
- Reforça [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md) — demonstra enquadramento legal "profissional de saúde" (art. 11 § 4º II)
- Habilita fechamento legal do [Sprint 20](../sprints/20-fisio-prontuario-cid-cif.md) e do [Sprint 22](../sprints/22-fisio-tiss-tuss-convenios.md)
- Fontes: Lei 3.268/1957 (CFM), Lei 6.316/1975 (COFFITO), Lei 6.583/1978 (CFN), Lei 9.696/1998 (CONFEF), Resolução CFM 2.299/2021, Resolução COFFITO 414/2012, Resolução CFN 599/2018
