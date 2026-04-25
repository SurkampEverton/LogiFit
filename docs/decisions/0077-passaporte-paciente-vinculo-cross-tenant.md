# ADR 0077 — Passaporte do paciente cross-tenant: vínculo por empresa + módulos liberados explicitamente + invite-link

- **Status:** Accepted (2026-04-25 — decisão formalizada na conversa; implementação técnica vive em Sprint 02 + posteriores conforme "Escopo de impacto")
- **Date:** 2026-04-25

## Context

Conversa de visão de produto (2026-04-25) revelou contradição entre a visão original e o modelo arquitetural vigente:

**Visão do usuário:** "todos os profissionais [da rede LogiFit] podem acessar os dados de um paciente em tenants diferentes" — paciente leva seu histórico de saúde entre Academia (Tenant A), Fisio (Tenant B) e Nutri (Tenant C), donos comerciais distintos.

**Modelo vigente** ([docs/acesso-e-autorizacao.md](../acesso-e-autorizacao.md)):

> "Dado individual nunca cruza `tenant_id` — mesmo com dono comum."

Princípio implícito (não regra numerada — referência a "regra 26" naquele doc era confusão histórica; regra 26 em [rules.md](../rules.md) é sobre `groups`, não pacientes). O princípio foi escrito assumindo que cross-tenant clínico era **pesadelo regulatório indesejável**. A visão de produto exige reabri-lo com controles fortes — agora explícito como **regra 42**.

[ADR 0069](0069-perfil-paciente-hub-operacional.md) já entregou o **hub operacional do paciente** (perfil unificado com tabs por especialidade), mas escopado **dentro de um tenant**. Falta a camada cross-tenant.

[ADR 0047](0047-cadastro-central-persons-contact-fk.md) já entregou `persons` como entidade canônica cross-tenant (sem `tenant_id`), o que viabiliza tecnicamente o modelo aqui proposto.

### Decisões prévias do usuário (2026-04-25)

1. **Caminho 2** descartado em favor de cross-tenant real entre profissionais (não só agregação do lado do paciente)
2. **Vínculo é cross-tenant** (rede LogiFit toda, não só intra-tenant)
3. **Paciente libera/bloqueia visualização** — controla granularmente
4. **Tenants nunca veem dados financeiros de outros tenants** — financeiro é privado por tenant
5. **Modelo C escolhido:** vínculo é com a **empresa**, mas **módulos liberados explícitos**, com **responsável técnico por módulo**
6. **5 módulos canônicos:** academia, personal_training, fisioterapia, nutricao, pilates — extensível via lookup table
7. **Aceite parcial:** paciente pode aceitar só alguns módulos do pedido (não tudo-ou-nada)
8. **Invite-link:** profissional cadastra dados mínimos → invite enviado por WhatsApp/email → paciente clica → cria conta (ou loga se já existe) → aceita pedido na sequência. **Sem stub** — dados pessoais só persistem após aceite.
9. **1 vínculo ativo por (paciente, módulo)** — nova empresa do mesmo módulo pede substituição
10. **Cobrança LogiFit:** 1 active member por (paciente, tenant), independente de quantos módulos do mesmo tenant

## Decision

### Parte 1 — Modelo de vínculo (Modelo C híbrido)

**Estrutura:**

```
patient_company_links — vínculo paciente↔empresa (1 linha por paciente×empresa)
   └── patient_link_modules — módulos liberados naquele vínculo (N linhas por link)
```

**Regras estruturais:**

- 1 paciente pode ter **N vínculos** (1 por empresa onde é atendido)
- Cada vínculo tem **N módulos** liberados (mín 1)
- **Constraint global:** 1 paciente tem no máximo **1 módulo do mesmo tipo ativo** em toda a rede
- Empresa multi-vertical (clínica com fisio + nutri) usa **1 vínculo com múltiplos módulos**
- Modo Solo (autônomo) é uma empresa com 1 módulo só

### Parte 2 — Schema

```sql
-- Lookup table dos módulos (extensível)
CREATE TABLE patient_module_types (
  key                   text PRIMARY KEY,
  label_pt_br           text NOT NULL,
  label_en_us           text NOT NULL,
  label_es_419          text NOT NULL,
  regulatory_body       text,                          -- 'CONFEF', 'COFFITO', 'CFN', null
  default_data_level    int NOT NULL DEFAULT 3,        -- 1..5 (ver Parte 4)
  active                bool NOT NULL DEFAULT true,
  created_at            timestamptz DEFAULT now()
);

-- Seed MVP
INSERT INTO patient_module_types (key, label_pt_br, label_en_us, label_es_419, regulatory_body, default_data_level) VALUES
  ('academia',          'Academia',          'Gym',                'Gimnasio',           'CONFEF',  3),
  ('personal_training', 'Personal Training', 'Personal Training',  'Entrenador Personal','CONFEF',  3),
  ('fisioterapia',      'Fisioterapia',      'Physical Therapy',   'Fisioterapia',       'COFFITO', 4),
  ('nutricao',          'Nutrição',          'Nutrition',          'Nutrición',          'CFN',     4),
  ('pilates',           'Pilates',           'Pilates',            'Pilates',            null,      2);

-- Vínculo paciente↔empresa
CREATE TABLE patient_company_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id             uuid NOT NULL REFERENCES persons(id),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  company_id            uuid NOT NULL REFERENCES companies(id),
  status                text NOT NULL CHECK (status IN ('pending','active','paused','revoked')),
  requested_by_user_id  uuid REFERENCES users(id),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  responded_at          timestamptz,
  expires_at            timestamptz,                   -- 12m default; renovação periódica LGPD
  paused_until          timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz DEFAULT now(),
  UNIQUE (person_id, company_id)                       -- 1 vínculo por (paciente, empresa)
);

-- Módulos liberados dentro do vínculo
CREATE TABLE patient_link_modules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id               uuid NOT NULL REFERENCES patient_company_links(id) ON DELETE CASCADE,
  module_type           text NOT NULL REFERENCES patient_module_types(key),
  primary_user_id       uuid REFERENCES users(id),     -- responsável técnico (CFM/COFFITO/CFN/CONFEF)
  data_level_max        int NOT NULL DEFAULT 3,        -- 1..5 — paciente pode subir/descer por módulo
  granted_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,                   -- nullable; null = ativo
  reason_revoked        text,
  UNIQUE (link_id, module_type)                        -- 1 módulo por vínculo
);

-- Constraint global: 1 módulo ativo por paciente em toda a rede
-- (precisa de trigger ou view porque atravessa duas tabelas)
CREATE UNIQUE INDEX one_active_module_per_person
  ON patient_link_modules (module_type, ((SELECT person_id FROM patient_company_links WHERE id = link_id)))
  WHERE revoked_at IS NULL;
-- (sintaxe ilustrativa; implementação real via trigger BEFORE INSERT/UPDATE)
```

**RLS:**

- `patient_company_links` e `patient_link_modules` **não têm `tenant_id` direto** (a tabela vincula tenants); RLS usa `EXISTS (SELECT 1 FROM ... WHERE tenant_id = jwt.tenant_id)` com `link.tenant_id`.
- `persons` (já existe ADR 0047) continua sem RLS de tenant — é canônica.
- **Exceção controlada da regra 26:** policy de leitura cross-tenant em tabelas clínicas/operacionais expandida pra reconhecer `patient_link_modules.granted` válido (status='active' + module ativo + data_level cobre).

### Parte 3 — Fluxo de invite (cadastro novo OU paciente existente)

```
Profissional cadastra dados mínimos do paciente:
  Nome + CPF + telefone + email (opcional)
  + módulos solicitados (1+) + responsáveis por módulo

Sistema valida:
  - CPF formato válido
  - Não há vínculo ativo entre essa empresa e esse CPF
  - Se já há, é UPSERT (adiciona módulos ao vínculo existente)

Sistema cria invite (token único, 7 dias)
Sistema NÃO cria registro de paciente — só o invite

Envio:
  - WhatsApp (default)
  - Email (paralelo, se informado)
  - Link curto: https://app.logifit.com.br/i/{token}

Paciente clica → backend resolve token → busca CPF na tabela persons:

┌──────────────────────────────────────────────────────────────┐
│ CAMINHO A: CPF EXISTE (já é usuário LogiFit)                │
├──────────────────────────────────────────────────────────────┤
│ 1. Tela: "Você já tem conta no LogiFit"                      │
│    Mostra nome mascarado ("M****a S***a") pra confirmar      │
│    [Sim, sou eu]  [Não sou eu, cancelar invite]              │
│ 2. Login (senha + MFA se aplicável)                          │
│ 3. Tela do pedido pendente (mesmo do caminho B)              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ CAMINHO B: CPF NÃO EXISTE (paciente novo)                    │
├──────────────────────────────────────────────────────────────┤
│ 1. Cadastro: confirma nome+CPF+telefone, define senha,       │
│    MFA opcional, aceita Termos + Política Privacidade        │
│ 2. Persons + user criados, login automático                  │
│ 3. Tela do pedido pendente                                   │
└──────────────────────────────────────────────────────────────┘

Tela do pedido pendente (ambos caminhos):

  "Clínica Bem-Estar quer te atender."
  Profissionais responsáveis:
    [✓] Fisioterapia → Dr. João Silva (CREFITO 12345)
    [✓] Nutrição    → Dra. Ana Costa (CRN 67890)

  Para cada módulo, paciente vê:
    - Nível de dado padrão (3 — pode ajustar pra 1..5)
    - Categorias incluídas (lista expansível)

  [Aceitar selecionados]   [Recusar tudo]
  [Aceitar parcialmente — opção avançada]
```

**Edge cases tratadas:**

| Situação | Comportamento |
|---|---|
| Invite expira (7d sem clique) | Token invalido; profissional vê "expirou" com botão "reenviar" |
| Paciente clica mas abandona cadastro | Rascunho 24h (recupera ao reabrir); depois disso recomeça |
| Paciente recebe N invites antes de criar conta | Todos viram "pedidos pendentes" na tela inicial pós-cadastro |
| Paciente recebe invite de empresa do MESMO módulo de empresa já vinculada | Sistema mostra: "Você já tem [Empresa Atual] como sua [Módulo]. Substituir por [Nova Empresa]?" — aceitar = vínculo antigo do módulo vai pra `revoked` |
| Tenant repete invite pra CPF existente que já recusou | Permitido após 30d; antes disso bloqueia (anti-spam) |
| CPF do invite ≠ CPF que paciente digita | Bloqueia + cria `system_alerts` no tenant emissor (possível phishing) |

### Parte 4 — Os 5 níveis de dados (taxonomia oficial)

Cada módulo tem um `default_data_level` (1..5). Paciente pode subir/descer por vínculo (`patient_link_modules.data_level_max`). Categorias por nível:

| Nível | Categorias incluídas | Default abre? |
|---|---|---|
| **1 — Identidade** | Nome, foto, data nascimento, sexo, contato emergência, convênio (nome+nº — sem detalhes financeiros) | Sempre quando vínculo ativo |
| **2 — Antropometria + sinais** | Peso, altura, IMC, bioimpedância, dobras, circunferências, wearables (FC repouso, sono, passos) | Default pra todos os módulos |
| **3 — Treino e hábitos gerais** | Plano de treino ativo, RPE, cargas, modalidades, restrições motoras, frequência (presença sim/não), plano alimentar (macros + restrições — sem diário detalhado) | Default `academia`, `personal_training`, `pilates` |
| **4 — Clínico** | Lesões ativas (CID/CIF), alergias, medicações em uso, doenças crônicas relevantes (diabetes, hipertensão, cardíaca), cirurgias relevantes (5 anos), exames lab alterados ou completos (escolha do paciente), diário alimentar detalhado | Default `fisioterapia`, `nutricao` |
| **5 — Workspace interno do profissional** | Notas privadas, hipóteses diagnósticas, avaliação de aderência, anotações comportamentais ("paciente difícil"), histórico financeiro do paciente naquele tenant | **Nunca compartilha** — nem é exibido pro paciente como toggle |

**Princípios duros:**

- Default **fechado** — Nível 4+ exige ação ativa do paciente
- Granularidade **por categoria + por vínculo** — paciente pode liberar lab pra um nutri e não pra outro
- **Nunca exibe "campo bloqueado"** — não mostrar pressiona consent. Simplesmente não aparece.
- Cross-tenant entrega **dado resumido**, não bruto — Tenant B recebe "lesão lombar ativa, restrição: sem deadlift", não SOAP completo do Tenant A
- Prontuário do médico (CFM 2.299) **nunca cruza profissional** — só **resumo gerado pelo paciente** pode

### Parte 5 — Substituição e revogação

**Substituir empresa em 1 módulo (ex: trocar fisio):**

```
Paciente clica "Trocar empresa neste módulo" no perfil
  → Lista alternativas (empresas que pediram vínculo recentemente OU busca livre)
  → Seleciona nova empresa
  → Sistema:
      UPDATE link_module_atual SET revoked_at = now(), reason_revoked = 'replaced'
      INSERT new patient_company_links (se nova empresa) OR adiciona módulo a link existente
  → Vínculo antigo: se sobrou nenhum módulo ativo, link inteiro vira 'revoked'
```

**Revogar vínculo inteiro:**

```
Paciente clica "Revogar acesso" da empresa
  → UPDATE patient_company_links SET status='revoked', revoked_at=now()
  → UPDATE TODOS patient_link_modules do link SET revoked_at=now()
  → RLS bloqueia leitura nova imediatamente
  → Dado já gerado pela empresa permanece com a empresa (CFM 2.299/COFFITO 415: 20 anos retenção)
  → Paciente vê audit: "Você revogou acesso de [Empresa] em [data]"
```

**Pausar (suspensão temporária, não revogação):**

```
status='paused' + paused_until = data
  → RLS bloqueia leitura até paused_until
  → Reativa automaticamente após data
  → Empresa vê "vínculo pausado pelo paciente" — não vê dados, mas sabe que existe
```

### Parte 6 — Profissional sai da empresa

Quando `primary_user_id` de um módulo deixa de pertencer ao tenant (ex: Dr. João demitido):

```
1. Trigger detecta saída → primary_user_id = null + system_alerts pro gerente do tenant
2. Paciente recebe notificação:
   "Seu fisio responsável Dr. João Silva não atende mais na Clínica Bem-Estar.
    O que você quer fazer?
    
    ○ Manter vínculo (clínica atribui novo responsável)
    ○ Seguir Dr. João no novo local (substituir vínculo)
    ○ Revogar"

3. Atenção regulatória — opção "seguir Dr. João":
   - Prontuário gerado na Clínica Bem-Estar PERMANECE com a Clínica
     (CFM 2.299/COFFITO 415 — instituição é guardiã, retenção 20 anos)
   - Novo vínculo começa VAZIO no novo local
   - Histórico anterior fica visível APENAS no perfil do paciente em modo
     "leitura legada" — Dr. João no novo local não vê
```

### Parte 7 — Integração com modelo de cobrança

- **Tenant é cobrado por active member** (sem mudança no [ADR 0066](0066-plano-comercial-pricing-trial.md))
- Active member = tem ≥1 vínculo ativo OU presença/cobrança no mês
- Paciente vinculado a 3 tenants distintos = conta como 1 active member em **cada um**
- Paciente vinculado a 1 tenant com 2 módulos = conta como **1 active member** (não 2)

### Parte 8 — Auto-cadastro proativo do paciente (path paralelo)

LogiFit é B2B, mas o paciente é dono dos dados. Existem **2 paths paralelos** para criar conta de paciente — ambos válidos, ambos suportados desde o MVP (Sprint 02):

#### Path A — Reativo (via invite do profissional, descrito em Parte 3)

Profissional → invite → paciente cria conta ao aceitar pedido.

#### Path B — Proativo (paciente chega sozinho)

```
Paciente vai em https://app.logifit.com.br/cadastro
  │
  ▼
Cadastro:
  Nome + CPF + telefone (com SMS de confirmação) + email (com link confirmação)
  Senha + MFA opcional + Cloudflare Turnstile (anti-bot)
  Aceita Termos + Política de Privacidade
  │
  ▼
Conta ativa, SEM vínculo nenhum
  │
  ▼
Tela inicial /meu/dashboard:
  "Você ainda não tem profissionais vinculados.
   
   [Aceitar pedido]      ← se houver invite pendente recebido depois
   [Convidar profissional]  ← path inverso (paciente convida empresa/profissional)
   [Atualizar meu perfil] [Sair]"
```

**O que paciente "solo" (sem vínculo) PODE fazer no app:**
- Atualizar perfil pessoal (foto, contato, endereço, alergias, medicações em uso, contato emergência)
- Aceitar/recusar pedidos de vínculo recebidos
- **Convidar profissional/empresa** (path inverso — ver abaixo)
- Visualizar histórico de invites enviados/recebidos
- Subir documentos pessoais (exames, laudos) **na pasta dele** — apenas ele vê (cross-tenant exige vínculo)

**O que paciente solo NÃO pode fazer (escopo MVP):**
- Log de treino próprio sem vínculo (não competimos com Strava/Apple Fitness — foge do foco)
- Diário alimentar próprio sem nutri vinculado
- Wearables conectados sem profissional (Sprint 32 vai reavaliar)

#### Path C — Convite inverso (paciente convida profissional/empresa)

```
Paciente clica "Convidar profissional" → busca por:
  - Nome do profissional/empresa
  - CPF/CNPJ
  - Cidade (filtro)

Resultados:
  ├─ Empresa/profissional ENCONTRADO no LogiFit
  │  → Paciente seleciona módulos desejados (ex: "quero fazer fisio com vocês")
  │  → Sistema cria pedido em sentido inverso
  │  → Empresa/profissional recebe notificação:
  │    "Maria Silva (CPF ...) quer ser sua paciente. Aceitar?"
  │  → Profissional aceita → vínculo ativo
  │
  └─ Empresa/profissional NÃO ENCONTRADO
     → "Esse profissional ainda não usa o LogiFit. Quer convidar?"
     → Paciente passa email/telefone do profissional
     → Sistema envia convite comercial: "Maria Silva quer te convidar pra usar
        o LogiFit. Crie sua conta gratuita..."
     → Vira lead comercial (registra em CRM da LogiFit)
     → Não cria pedido de vínculo (profissional precisa entrar primeiro)
```

#### Anti-spam e segurança do path B

- **Confirmação dupla obrigatória:** SMS + email confirmados antes de conta ativar
- **CPF único na rede** — 1 conta por CPF (constraint global em `persons`)
- **Cloudflare Turnstile** no signup (free tier — já provisionado no Sprint 00)
- **Rate limit:** 3 cadastros/h por IP, 1 cadastro/dia por mesmo CPF tentado (anti-fraude)
- **Verificação de CPF na Receita** (BrasilAPI / ReceitaWS — já provisionado no [ADR 0048](0048-cnpj-busca-automatica.md)) — opcional, ativada em Fase 2 se fraude virar problema

#### Cobrança no Path B

- Paciente sem vínculo → **não conta** como active member em nenhum tenant → **LogiFit não cobra ninguém**
- Paciente vira active member do tenant **apenas após aceitar vínculo** com aquele tenant
- Custo de hospedar paciente solo é desprezível (poucos KB de dados de identidade)

#### Estratégia de produto (não-vinculante, contexto)

Path B **não dispersa o foco B2B** — pelo contrário, vira:
- **Aquisição de baixo custo** (paciente proativo "puxa" academia/clínica pro LogiFit)
- **Defensibilidade:** dado pertence ao paciente, profissional precisa do LogiFit pra acessar
- **Narrativa LGPD forte:** "seu dado, sua conta, você convida quem quiser"

Não vamos investir marketing pesado em Path B no MVP — ele existe pra **não bloquear** o paciente que chega sozinho. Marketing pesado é decisão pós-MVP.

### Parte 9 — Audit obrigatório cross-tenant

Toda leitura cross-tenant via vínculo grava em `patient_data_access_log` (síncrono não-bloqueante via trigger):

```sql
CREATE TABLE patient_data_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       uuid NOT NULL,
  link_id         uuid NOT NULL,
  reader_user_id  uuid NOT NULL,
  reader_tenant_id uuid NOT NULL,
  source_tenant_id uuid NOT NULL,                -- tenant que ORIGINOU o dado
  module_type     text NOT NULL,
  category        text NOT NULL,                  -- ex: 'lab_results', 'training_plan'
  resource_type   text,
  resource_id     uuid,
  read_at         timestamptz DEFAULT now(),
  ip              inet,
  request_id      uuid
) PARTITION BY RANGE (read_at);                   -- mensal (regra 34)
```

Paciente vê resumo em `/meu/privacidade/acessos`: "Dr. João Silva (Clínica Bem-Estar) leu seus exames laboratoriais em 23/04/2026 às 14:32".

## Consequences

### Mudanças em regras

- **Regra 42 nova** ([docs/rules.md](../rules.md)): "Dado individual de paciente cruza `tenant_id` SOMENTE via vínculo `patient_company_links` ativo + módulo `patient_link_modules` autorizado + categoria coberta pelo `data_level_max`. Toda leitura cross-tenant grava `patient_data_access_log` no mesmo turno. Limites duros que nunca cruzam mesmo com vínculo: financeiro, Nível 5, prontuário CFM original, dado de outras pessoas. Lint `cross-tenant-read-must-log` enforça."
- **Regra 26 NÃO muda** — continua sobre `groups` (camada visual/agregada). A confusão histórica em [docs/acesso-e-autorizacao.md](../acesso-e-autorizacao.md) ("dado individual nunca cruza tenant — regra 26") era referência incorreta; era princípio implícito, não regra numerada. Agora está explícito como **regra 42** com exceção controlada.

### Mudanças em ADRs anteriores

- **ADR 0005** (RBAC com consent cross-module) — expandido: cross-tenant via vínculo é nova forma de "consent", coexiste com consent intra-tenant.
- **ADR 0067** (DPO) — DPO precisa modelar **co-controllership LGPD** entre paciente, empresa-origem, empresa-destino, e LogiFit (operador).
- **ADR 0069** (hub do paciente) — perfil `/app/members/[id]` ganha indicador "vinculado em N empresas" + tab "Outras Empresas" (read-only, mostra dado liberado por outros tenants).

### Sprints afetados

| Sprint | Impacto |
|---|---|
| [Sprint 02 — CRM](../sprints/02-geral-crm-pessoas.md) | Adiciona fluxo de invite + tela de pedidos pendentes; perfil do paciente passa a ler vínculos |
| [Sprint 03 — Agenda](../sprints/03-geral-agenda-universal.md) | Agenda do paciente agrega compromissos cross-tenant (quando ele consente) |
| [Sprint 04 — Financeiro](../sprints/04-geral-financeiro-asaas.md) | Garante que dado financeiro NUNCA aparece cross-tenant (RLS extra) |
| [Sprint 06 — Copilot](../sprints/06-geral-copilot-base.md) | IA cross-tenant lê apenas o que vínculo permite + audit |
| [Sprint 11 — Prescrições](../sprints/11-geral-prescricoes-e-biblioteca.md) | Detecta conflito cross-prescrição (ex: dieta hipocalórica + treino aumentado em outro tenant — alert) — **diferencial-chave** do produto |
| [Sprint 12 — Avaliações físicas](../sprints/12-geral-avaliacoes-fisicas.md) | Antropometria cross-tenant (Nível 2) compartilhada por default |
| [Sprint 26 — Portal paciente](../sprints/26-geral-portal-paciente-web.md) | Tela `/meu/privacidade/compartilhamento` + audit `/meu/privacidade/acessos` + revogação |

### Riscos abertos

1. **Regulatório CFM/COFFITO/CFN** — não há norma específica sobre troca clínica entre instituições mediada por consent do paciente. **Ação:** parecer jurídico antes do GA + RIPD específico cross-tenant.
2. **Co-controllership LGPD** — paciente é controlador? Co-controlador com a empresa? LogiFit é operador. **Ação:** DPO documenta em [ADR 0067](0067-dpo-governanca-compliance-lgpd.md) addendum.
3. **Liability** — se Tenant B age baseado em dado errado vindo de Tenant A, quem responde? **Ação:** Termo de Uso explicita: dado cross-tenant é informativo, profissional do Tenant B é responsável pela decisão clínica que tomar.
4. **Performance** — query de perfil paciente cruzando N tenants pode ser cara. **Ação:** view materializada `mv_patient_cross_tenant_summary` refrescada por trigger; cache de 5min em Redis pra leituras agregadas.
5. **Adversarial** — empresa cria invites em massa (spam). **Ação:** rate limit por empresa: máx 50 invites/dia + máx 3 invites pra mesmo CPF/30d.
6. **Profissional desonesto** — fisio sai da Clínica X, abre Clínica Y, manda invites pros pacientes antigos. **Ação:** UX de aceite mostra "essa empresa é nova pra você" + alerta visual se o profissional aparece em outra empresa onde já houve vínculo.
7. **Sharding futuro (regra 34)** — ADR 0072 prevê tenants grandes migrarem pra DB própria. Cross-tenant via vínculo **vira cross-database**. **Ação:** documentar no ADR 0072 addendum que tenants com vínculo cross ativo **não migram** pra shard separado no MVP; pós-MVP exige federation layer.

### Diferencial-chave do produto

Este ADR habilita o que torna LogiFit único: **alerta cross-prescrição automatizado**.

```
Cenário:
  Tenant A (Nutri Ana) prescreve dieta 1.400 kcal hipocalórica
  Tenant B (Personal Maria, Academia Forma) aumenta volume de treino
  Tenant C (Fisio Bem-Estar) detecta cruzamento: risco de hipoglicemia

Sistema avisa:
  Quando Personal Maria abre treino:
    "⚠️ Esse paciente tem prescrição nutricional ativa de outra empresa
       (Nutri Ana). Restrições: 1.400 kcal/dia. Considere antes de aumentar volume."

  Quando Nutri Ana ajusta dieta:
    "⚠️ Paciente aumentou volume de treino esta semana em outra empresa
       (Personal Maria). Considere ajuste calórico."
```

Isso só existe porque os dados cruzam. É o motivo de ter LogiFit em vez de 3 sistemas separados.

## Status

Proposed — aguarda:
- Confirmação do usuário sobre constraint global (1 módulo ativo por paciente em toda a rede) — implementação via trigger é viável mas tem custo
- Definição do limite de invites/dia por tenant (default sugerido: 50)
- Parecer jurídico cross-tenant clínico antes da implementação no Sprint 02

## Referências

- [ADR 0002 — RLS como isolamento primário](0002-rls-como-isolamento-primario.md)
- [ADR 0005 — RBAC com consent cross-module](0005-rbac-com-consent-cross-module.md)
- [ADR 0047 — Cadastro central persons (Contact-FK)](0047-cadastro-central-persons-contact-fk.md)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0067 — DPO + governança LGPD](0067-dpo-governanca-compliance-lgpd.md)
- [ADR 0069 — Perfil do paciente como hub operacional](0069-perfil-paciente-hub-operacional.md)
- [ADR 0072 — Escalabilidade do banco (particionamento + cold storage)](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- [docs/acesso-e-autorizacao.md](../acesso-e-autorizacao.md)
- [docs/rules.md](../rules.md) — regras 25, 26 (revisada), 42 (nova)
