---
slug: cid-cif-catalogos-globais
status: proposed
date: 2026-05-17
---

# ADR 0028 — CID-11 + CIF como catálogos globais versionados curados pela LogiFit

## Contexto

Sprint 20 entrega prontuário eletrônico Fisio/Médico/Nutri (consultas) com obrigatoriedade de ao menos 1 código **CID-11** principal e suporte opcional a códigos **CIF** com qualifier 0-4. Ambos são taxonomias gigantes:

- **CID-11** (WHO 2022, revisão 2024): ~17.000 códigos primários + 120.000 quando inclui modificadores; chapters MA-Z (Z = códigos para circunstâncias sem doença); update anual oficial pela WHO + tradução pt-BR pelo Datasus.
- **CIF** (WHO 2001): ~1.500 códigos organizados em 4 componentes (Funções `b`, Estruturas `s`, Atividades/Participação `d`, Fatores Ambientais `e`) + qualifier 0-4; tradução pt-BR ABBR.

**Decisões em jogo:**

1. **Onde vivem os catálogos:** tabela global LogiFit (1 cópia) vs por-tenant (cada tenant carrega o seu) vs via API externa (WHO ICD-11 API)
2. **Quem atualiza:** LogiFit admin ou cada tenant escolhe sua versão
3. **Quanto carregar inicialmente:** seed completo (17k+1.5k) vs minimum viable (top 50 fisio/clínica)

### Cenário regulatório

- **CFM 2.299/2021** + **COFFITO 414/2012** exigem CID como diagnóstico mínimo do prontuário (médico) ou justificativa terapêutica (fisio).
- **Lei 13.787/2018** estabelece retenção 20a — código atribuído hoje precisa **continuar reconhecível** em 20 anos. Versionamento é crítico: `cid_catalog` mantém `version='CID-11'` + `release_date YYYY-MM-DD` para permitir interpretação histórica.
- **CIF** não é obrigatório no Brasil, mas Datasus + ABBR recomendam para fisio com objetivo funcional documentado (CIF traz mais riqueza que CID puro pra "dor crônica funcional" etc).

## Decisão

### 1. Catálogos globais, leitura para todos os tenants

```sql
CREATE TABLE cid_catalog (
  code text PRIMARY KEY,            -- ex: 'MG30.0' (dor lombar)
  description text NOT NULL,
  chapter text,                     -- ex: 'MG' (Sintomas musculoesqueléticos)
  version text NOT NULL DEFAULT 'CID-11',
  active boolean NOT NULL DEFAULT true,
  release_date text                 -- YYYY-MM-DD oficial WHO
);

CREATE TABLE cif_catalog (
  code text PRIMARY KEY,            -- ex: 'b280'
  description text NOT NULL,
  component cif_component NOT NULL, -- 'body_functions'|'body_structures'|'activities_participation'|'environmental_factors'
  active boolean NOT NULL DEFAULT true
);
```

**Sem `tenant_id`** — são taxonomias da WHO, não do tenant. RLS pura libera SELECT a todos (`USING (true)`). INSERT/UPDATE só via migration LogiFit (sem policy app — privilégio do role migrator).

### 2. Update via migration anual (não API externa)

**Rejeitado:** WHO ICD-11 API. Motivos:
- Latência inconsistente; quebra Server Actions em offline mode
- Sub-processor adicional na lista LGPD
- WHO API tem rate limit + auth OAuth — overhead operacional para algo que muda 1×/ano
- Tradução pt-BR não vem na API oficial; Datasus disponibiliza dump XML separado

**Aceito:** migration anual `db/migrations/XXXX_cid_v2027.sql` carregando dump WHO + tradução Datasus pré-processado. Update assistido pelo admin LogiFit (regra 46 — toda dep externa exige ADR; **WHO/Datasus não são deps run-time**, são fonte de dados estática). Próximo update planejado: 2027-Q1 (release WHO 2027).

### 3. Seed MVP minimal — top 50 fisio/clínica + top 30 CIF

Sprint 20 seed carrega apenas os códigos mais usados em academia/clínica/personal/nutri pra MVP rodar sem precisar migration de 17k linhas. Lista curada:

**CID-11 top 50:**
- Musculoesqueléticos (MG): lombalgia, cervicalgia, tendinopatias ombro/cotovelo/joelho, fasciite, bursite, condromalácia, capsulite adesiva
- Reumatológicos (FA): artrite reumatoide, osteoartrose, espondilite, fibromialgia, gota
- Neurológicos (8B): hemiplegia, paraplegia, AVC sequela, esclerose múltipla
- Respiratórios (CA): asma, DPOC, pneumonia (já reabilitação respiratória)
- Endócrinos (5A/5B): DM2, obesidade, dislipidemia, síndrome metabólica
- Z (sem doença): consulta para promoção saúde, avaliação física pré-treino, retorno pós-cirurgia

**CIF top 30:**
- Funções (b): b280 dor, b730 força muscular, b740 resistência, b770 marcha, b430 hematológicas
- Estruturas (s): s750 membro inferior, s760 tronco, s730 membro superior
- Atividades/Participação (d): d450 andar, d540 vestir-se, d640 trabalhar, d910 vida comunitária
- Fatores ambientais (e): e310 família, e355 profissionais saúde, e398 outros relacionamentos próximos

Migration próxima carrega o restante (rodada de demanda real).

### 4. Versionamento + retro-compatibilidade

Códigos depreciados (raros — CID-11 vs CID-10 ainda permite mapeamento bridge) ganham `active=false`. **NÃO** deleta — mantém leitura pra prontuários antigos que referenciam. Migration nova preserva FKs históricas (`consulta_cids.cid_code` → `cid_catalog.code` com `ON DELETE RESTRICT`).

### 5. UI read-only `/app/catalogos/cid` + `/app/catalogos/cif`

Tela de busca por código + descrição. Não há CRUD — apenas listagem + busca. Útil pra profissional decorar códigos novos ou treinar equipe.

## Consequências

### Boas

- Schema simples (2 tabelas globais; sem migration de RLS complexa)
- Update controlado pela LogiFit elimina drift entre tenants
- Bridge histórico funciona com `active=false` sem deletes destrutivos
- Seed minimal acelera dev/demo; expansão sob demanda real

### Ruins

- Catálogo "incompleto" no MVP — profissional pode precisar de código não-seedado (UI mostra mensagem clara + form de "solicitar inclusão" como pendência rolling)
- WHO solta atualizações; LogiFit precisa do processo trimestral de checar release + preparar migration
- Tradução pt-BR depende do Datasus republicar dump quando WHO atualiza — janela de defasagem possível

### Riscos

- **Tenant médico em hospital grande** pode reclamar de catálogo incompleto → mitigação Sprint 20+ carrega CID-11 completo via migration grande (uma única vez); o seed atual cobre 80% das consultas fisio típicas
- **Tradução discutível** entre Datasus e SBC/SBM/etc → manter `description` exatamente como Datasus publica; profissionais usam código + descrição contextual no SOAP

### Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Por-tenant (cada tenant edita) | Erro de digitação vira diagnóstico inventado; sem auditoria de mudança taxonômica |
| API WHO ICD-11 em runtime | Latência + dep externa adicional + rate limit |
| Catálogo completo no seed inicial | 17k inserts atrasam `db:seed` em ~30s; UX dev pior; expansão lazy é melhor |

## Status

**Proposed.** Promove para **Accepted** quando primeira migration de release real (2027-Q1) executar com sucesso em produção (validação de operação contínua, não só dev).

## Referências

- Sprint 20 [`docs/sprints/20-fisio-prontuario-cid-cif.md`](../sprints/20-fisio-prontuario-cid-cif.md)
- [ADR 0032](0032-assinatura-prontuario-por-profissao.md) — consome CID via `consulta_cids`
- [ADR 0072](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md) — retenção 20 anos consultas + CID histórico
