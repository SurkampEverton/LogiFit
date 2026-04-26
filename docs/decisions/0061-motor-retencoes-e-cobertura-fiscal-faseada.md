# ADR 0061 — Motor de retenções tributárias + cobertura fiscal faseada

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

Verificação dos 7 grupos de impostos que podem incidir na operação dos tenants LogiFit:

| Grupo | Descrição |
|---|---|
| **A.** Impostos da NF emitida (ISS, ICMS, PIS/COFINS na nota) |
| **B.** Retenções em AP (tenant paga fornecedor PJ/PF/aluguel) |
| **C.** Apuração mensal de receita (Simples/Presumido/Real) |
| **D.** Guias oficiais (DAS/DARF/DAM/DIRF) |
| **E.** Obrigações acessórias (SPED/ECD/ECF/PGDAS-D/DEFIS) |
| **F.** Folha CLT + eSocial |
| **G.** Tributação de profissional autônomo (RPA/INSS 11%/IRRF/ISS retido) |

Cobertura atual pós-Sprints 15/23/36:
- **A** ✅ coberto (Focus NFe calcula na emissão — ADR 0059)
- **B** ⚠ Sprint 15 tem AP mas não calcula retenções
- **C, D, E, F** ✗ não cobertos (depende de contador externo hoje)
- **G** ⚠ Sprint 23 calcula comissão bruta, não retenções

Decisão do usuário (2026-04-23): **LogiFit vai cobrir todos os 7 grupos internamente no longo prazo**, mas entrega faseada. Agora aplicamos só **B + G + infra de export** para contador externo; C/D/E/F viram sprints dedicados mais à frente, com tempo para amadurecer requisitos e avaliar se continua valendo cobrir internamente vs integrar com plataforma contábil existente.

## Decision

### Princípio guia

LogiFit **assume progressivamente** motor tributário nacional — não vira "software contábil genérico" concorrente da Alterdata, mas cobre o que é necessário para tenants de saúde operarem de ponta a ponta sem sair do sistema. Fronteira: tudo que o operador **precisa ver/decidir** durante a operação fica dentro; entrega burocrática (SPED, ECF anual) pode ficar externa se maturidade do mercado não permitir diferenciação.

### Fase atual — Grupos B + G + export contábil

Implementado nos Sprints 15/23/36 (já existentes) + Sprint 01b (role):

#### 1. Catálogo de naturezas tributárias (`tax_natures`)

```sql
tax_natures
  id uuid pk
  tenant_id uuid nullable           -- null = global curado LogiFit; não-null = custom do tenant
  code text not null                -- ex: 'servico_prestado_pj', 'autonomo_rpa', 'aluguel_pf'
  label text not null
  applies_to text not null          -- 'ap','professional_contract','both'
  retentions jsonb not null
    -- shape: [{ tax, rate?, rate_table?, threshold_cents?, cap_cents?, condition? }]
  regulatory_reference text         -- ex: 'Lei 10.833/2003 art. 30', 'RFB IN 1.234/2012'
  active bool default true
  archived_at timestamptz nullable
  created_at timestamptz default now()
  unique (tenant_id, code) nulls not distinct
```

**Seed global inicial** (10 naturezas mais comuns — tenant herda automaticamente):

1. `servico_prestado_pj_geral` — PIS 0,65% + COFINS 3% + CSLL 1% + IRRF 1,5% (total 6,15%) — Lei 10.833/2003
2. `servico_prestado_pj_saude` — mesmo acima + observação "verificar não cumulatividade PIS/COFINS"
3. `autonomo_rpa_pf` — INSS 11% (teto) + IRRF tabela progressiva + ISS retido quando tomador PJ
4. `aluguel_pj` — IRRF 1,5% + PIS/COFINS/CSLL 4,65% (acima de R$ 10)
5. `aluguel_pf` — IRRF tabela progressiva (acima de R$ 1.903,98 em 2026)
6. `software_saas_pj` — PIS/COFINS/CSLL 4,65% + IRRF 1,5% + ISS retido condicional
7. `comissao_autonomo_pf` — INSS 11% + IRRF tabela progressiva
8. `servico_transporte_pj` — PIS/COFINS/CSLL 4,65% + IRRF 1% (ou 1,5% conforme caso) + ISS retido
9. `utilidade_publica` (água/luz/telefone) — sem retenção (concessionária)
10. `simples_nacional_anexo_iii` — sem retenção federal (tomador não retém de prestador Simples)

**Admin do tenant pode:**
- **Criar natureza custom** (ex: regime específico local, serviço raro)
- **Desativar natureza global** (se não se aplica ao negócio)
- **Não pode editar natureza global** (ficaria divergente entre tenants)

#### 2. Retenções aplicadas (`tax_retentions`)

```sql
tax_retentions
  id uuid pk
  tenant_id uuid not null
  source_type text not null          -- 'ap' | 'commission_entry'
  source_id uuid not null
  tax_nature_id uuid fk tax_natures
  tax text not null                  -- 'pis','cofins','csll','irrf','inss','iss'
  base_cents bigint not null
  rate_applied numeric not null      -- % efetivamente aplicada
  amount_cents bigint not null       -- valor retido
  should_withhold bool not null      -- true = tenant é responsável por reter
  guide_status text default 'pending' -- 'pending','paid','reconciled'
  guide_reference text nullable      -- número DARF/GPS colada pelo operador após pagar
  paid_at timestamptz nullable
  calculated_at timestamptz default now()
```

Unique constraint: `(source_type, source_id, tax)` — uma retenção por tributo por fonte.

#### 3. Integrações nos sprints existentes

- **Sprint 15** — UI de AP com select "Natureza tributária" que calcula e mostra retenções em tempo real; `accounts_payable.net_amount_cents` (calculado = bruto - retenções)
- **Sprint 23** — cálculo automático de retenção sobre comissão/RPA quando profissional é PF autônomo; valor líquido vai para `commission_entries.net_amount_cents`
- **Sprint 36** — aba `/app/fiscal/retencoes` com relatório mensal agrupado por tributo + export PDF/CSV para contador gerar DARF

#### 4. Role `contador_externo` (Sprint 01b)

- Permissions: `fiscal.read` + `financeiro.read` + `nfe.read` em **todas** as companies do tenant
- **Sem escrita** em nenhum módulo (adequado para LGPD art. 11 — dado fiscal consolidado, não clínico)
- Acesso via magic link por convite do admin (reusa fluxo Sprint 01a)
- MFA obrigatório (regra 43) — evita compartilhamento
- Separado de `contador_interno` (role futura se tenant tiver contador funcionário)
- Portal específico `/app/contador` — focado em export, relatórios, download em massa de XMLs; não tem acesso a clientes/members

#### 5. Export completo para contador

- `/app/contador` (nova) — portal read-only
- Download em massa ZIP de XMLs por período (recebidos + emitidos)
- CSV/OFX de AP/AR
- Relatório de retenções por tributo
- Campo `guide_reference` colável após contador gerar DARF externamente

### Fases futuras — Grupos C, D, E, F como sprints novos

Mapeados no roadmap (`docs/roadmap.md`) sem arquivos de sprint ainda. Cada um com sua pergunta aberta sobre ambição (cobrir internamente vs integrar com provider).

| Sprint futuro | Grupo | Escopo inicial mapeado | ADR esperado |
|---|---|---|---|
| **37 — Apuração mensal de receita** | **C** | Calcula **receita bruta** consolidada do mês + base Simples/Presumido/Real por regime cadastrado; gera "pré-DAS" ou "pré-DARF" com memorial; **não emite guia oficial** nesta fase | ADR a alocar quando Sprint 37 entrar (≥0080 conforme [roadmap §Convenção de numeração](../roadmap.md)) |
| **38 — Geração de guias oficiais** | **D** | Após apuração, gera boleto DAS (via API RFB/PGDAS-D) + DARF (código de receita + barcode) + DAM municipal quando suportado; opcional integração com Contabilizei/Conube/Omie | ADR a alocar quando Sprint 38 entrar (≥0080) |
| **39 — Obrigações acessórias (SPED/ECD/ECF)** | **E** | Gerador de arquivo SPED Fiscal (EFD-ICMS/IPI) + SPED Contribuições + ECD + ECF + PGDAS-D + DEFIS + DCTF-Web + DIRF. **Alta complexidade** — decidir se é motor interno ou integração com provider tributário especializado (SCI, Alterdata, Domínio) | ADR a alocar quando Sprint 39 entrar (≥0080) |
| **40 — Folha CLT + eSocial** | **F** | Folha completa (salários, horas extras, DSR, benefícios, férias, 13º, rescisão) + INSS patronal 20% + RAT + terceiros + FGTS 8% + IRRF folha + envio eventos eSocial (S-1000 a S-5013). **Muito complexo** — provável integração com provider (TOTVS, Senior, ADP) ou motor próprio após pesquisa | ADR a alocar quando Sprint 40 entrar (≥0080) |

**Princípio**: esses 4 sprints só entram em planejamento ativo quando (a) primeiro tenant pagante tiver demanda real **e** (b) análise custo/benefício mostrar que integração externa não é melhor caminho. Ficam no roadmap para sinalizar ambição mas sem data.

### Integrações com plataformas contábeis — extensão documentada

**Não implementamos agora.** Mas deixamos no radar do ADR como caminho alternativo:

- **Contabilizei** — API pública; tenant que usa já tem conta contábil; LogiFit sincroniza XMLs + AP/AR
- **Conube** — foco em micro/pequeno; API + webhook
- **Omie Contabilidade** — ERP contábil; tem API de sincronização
- **Alterdata Shop** — sistema pesado; tem API para integração
- **Domínio Sistemas** — referência em contabilidade; API custom

Quando Sprint 37+ entrar em discussão, o ADR alocado para Sprint 37 (≥0080) escolhe: motor interno ou delegação. Se delegação, entra **ADR de integração com provider contábil escolhido**.

## Consequences

### Positivas

- **Gap B e G cobertos** sem atraso — operador sabe valor líquido de cada AP e cada comissão RPA desde o dia 1
- **Contador externo tem portal próprio** — LGPD respeitado, acesso controlado, auditado, nunca vê prontuário
- **Export unificado** — contador baixa XMLs + CSVs em 1 clique; hoje isso é o que realmente importa para apuração
- **Roadmap honesto** — Grupos C/D/E/F não ficam escondidos; usuário e investidores enxergam ambição
- **Diferenciação clara** — LogiFit é ERP integrado com tributário "operacional"; apuração/SPED/folha fica com especialista até amadurecermos
- **Naturezas globais curadas + custom do tenant** — balanceia padronização com flexibilidade

### Negativas (mitigáveis)

- **Tenant espera "tudo pronto"** — marketing não pode prometer cobertura fiscal completa; materiais comerciais explicitam "motor tributário operacional; obrigações acessórias com seu contador"
- **Atualização de alíquotas** — IRRF, INSS, Simples mudam anualmente ou mais; job de atualização das `tax_natures` globais tem que rodar no começo de cada ano; alertar admin dos tenants
- **Tabela progressiva IRRF é complexa** — alíquotas escalonadas por faixa; calculadora `packages/ai/fiscal/tax-calculator.ts` precisa cobrir bem; testes unit com cenários extensos
- **ISS retido depende de município** — nem todo município tem mesmo regime de substituição tributária; natureza `aluguel_pf` funciona em SP mas pode divergir em outros; mitigado por `retentions[].condition` que permite regra por UF/município
- **Contador pode pedir formato específico de export** — cada software contábil aceita CSV/TXT próprio; começamos com CSV genérico + XMLs brutos; negociamos formatos customizados sob demanda
- **Roadmap longo para C/D/E/F** — tenants médios/grandes (redes com ≥5 filiais) podem pressionar antes; aceitar e priorizar conforme demanda

### Riscos não endereçados

- **Mudança de regime do tenant** (Simples → Presumido) no meio do ano — recalcular retenções retroativamente é caro; decidir no Sprint 37
- **Retenção em cascata** — tenant é PJ cliente de contador PJ que também é cliente de... — cenário raro; fora do escopo imediato
- **Tributação de resident estrangeiro** — raro em LogiFit; se surgir, ADR específico

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Cobrir A-G todos agora | 4 sprints grandes de trabalho + motor tributário + eSocial — explode escopo; adia entrega de B/G que é dor imediata |
| Nunca cobrir C/D/E/F, sempre externo | Tenant grande (rede saúde) migra para ERP integrado quando tem escala; perder isso é perder mercado |
| Integrar com Contabilizei desde já | Contabilizei é bom para micro; médio/grande usa outros; lock-in prematuro. Integração fica como opção futura |
| Motor próprio de SPED desde Sprint 15 | SPED tem 20+ blocos + mudanças anuais; competência profunda; não entrega valor no MVP |
| Não ter role `contador_externo` | Admin do tenant precisaria compartilhar senha ou criar role "admin limitado" ad-hoc; audit bagunça; inseguro |

## Escopo de impacto — Fase atual

**Novo ADR:** este (0061).

**Sprints ajustados:**
- **01b** — role `contador_externo` + permissions `fiscal.read`, `financeiro.read`, `nfe.read` em todas companies; fluxo de convite via magic link; MFA obrigatório; portal dedicado `/app/contador`
- **15** — schemas `tax_natures` + `tax_retentions`; calculadora em `packages/ai/fiscal/tax-calculator.ts`; UI de AP com select de natureza + preview de retenções; coluna `accounts_payable.net_amount_cents`; seed de 10 naturezas globais
- **23** — cálculo automático de retenção em RPA/comissão autônomo; coluna `commission_entries.net_amount_cents`; UI mostra bruto → retenções → líquido
- **36** — aba `/app/fiscal/retencoes` com relatório mensal por tributo; export PDF/CSV; portal `/app/contador` com download em massa + CSVs

## Escopo de impacto — Fases futuras (mapeadas, não implementadas)

- **Sprint 37** — Apuração mensal (Grupo C) → ADR ≥0080 (a alocar)
- **Sprint 38** — Guias oficiais (Grupo D) → ADR ≥0080 (a alocar)
- **Sprint 39** — Obrigações acessórias SPED (Grupo E) → ADR ≥0080 (a alocar)
- **Sprint 40** — Folha CLT + eSocial (Grupo F) → ADR ≥0080 (a alocar)
- Integrações com Contabilizei/Conube/Omie/Alterdata/Domínio mencionadas como opções a avaliar no Sprint 37+

## Related

- Estende [ADR 0059 — Ciclo fiscal emissão via Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) (Focus cobre Grupo A; este cobre B/G)
- Reforça [ADR 0005 — RBAC com consent cross-module](0005-rbac-com-consent-cross-module.md) (role `contador_externo` nova)
- Reforça [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md) (contador externo nunca vê prontuário; RLS + permission tabulada)
- Fontes: Lei 10.833/2003 (retenções federais PIS/COFINS/CSLL), IN RFB 1.234/2012 (retenções), Tabela IRRF anual RFB, Portaria INSS anual (teto), LC 116/2003 (ISS municipal), Lei 9.430/1996 (IRRF PJ)
