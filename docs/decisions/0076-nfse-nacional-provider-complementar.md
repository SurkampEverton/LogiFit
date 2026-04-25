# ADR 0076 — NFS-e Nacional como provider complementar (caminho de redução de custo fiscal)

- **Status:** Accepted
- **Date:** 2026-04-25

## Context

[ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) (accepted 2026-04-23) decidiu que **LogiFit não toca em motor tributário** e delega 100% da emissão fiscal ao provider **Focus NFe**. Decisão correta para o MVP — evita virar empresa de software fiscal e reduz risco regulatório.

Em 2026-04-25, ao revisar o modelo de custo do [ADR 0066](0066-plano-comercial-pricing-trial.md), identificamos que o custo Focus NFe foi **subestimado** para tenants de alto volume:

| Plano | Notas/mês estimadas | Custo Focus a R$ 0,30 médio | % da mensalidade |
|---|---|---|---|
| Starter R$ 99 | ~50 | R$ 15 | 15% |
| Pro R$ 199 | ~500 | R$ 150 | 75% |
| Business R$ 449 | ~2.000 | R$ 600 | 134% ⚠️ |

A margem bruta em Business com alto volume vira **negativa** se o LogiFit absorver 100% do custo Focus NFe — modelo insustentável.

[ADR 0066](0066-plano-comercial-pricing-trial.md) já está sendo revisado para introduzir **notas fiscais inclusas + overage** (igual a members), mas mesmo com repasse vale ter um caminho técnico para **reduzir o custo unitário** ao longo do tempo.

### NFS-e Nacional — visão geral

A **NFS-e Padrão Nacional** é uma iniciativa do governo federal (Receita Federal + ABRASF + CNM) que unifica a emissão de notas de serviço municipais num **web service único e gratuito**, hospedado no ambiente nacional (ADN — Ambiente de Dados Nacional).

| Aspecto | Status (abril/2026) |
|---|---|
| **MEIs** | Obrigatório desde 2023 — 100% no padrão nacional |
| **Demais contribuintes** | Adesão **municipal voluntária** — capitais e cidades médias aderiram, cobertura ainda parcial |
| **Custo por nota** | R$ 0 (gratuito, infra federal) |
| **Padrão XML** | Modelo Conceitual ABRASF + extensões nacionais |
| **Autenticação** | gov.br + certificado ICP-Brasil |
| **Cobertura municipal** | Estimativa abril/2026: ~40-60% das emissões nacionais (capitais + grandes cidades aderidas) |

### Tensão a resolver

| Problema | Como NFS-e Nacional ajuda |
|---|---|
| Custo Focus de R$ 0,15-0,50/nota corrói margem em alto volume | Para municípios aderidos, custo cai para R$ 0 |
| Risco de cobertura: Focus pode aumentar tabela | Provider gratuito alternativo reduz lock-in |
| Tenants em capitais geram volume alto e estão exatamente em municípios já aderidos | Concentração de volume coincide com cobertura nacional |

### Limitações da NFS-e Nacional

| Limitação | Impacto LogiFit |
|---|---|
| **Cobertura municipal incompleta** | Cidades pequenas ainda dependem de Focus |
| **Só cobre serviço (NFS-e)** — nada de NF-e produto, NFC-e, devolução, transferência, conserto | LogiFit precisa de Focus para ~7 dos 8 tipos de documento |
| **Cancelamento, CC-e, eventos** seguem regras municipais — não unificadas | Focus continua mais simples para eventos |
| **Manutenção quando layout muda** | LogiFit assume vs Focus assume |
| **Suporte gov.br** vs SLA Focus | Risco operacional maior |
| **Certificado A1 ICP-Brasil obrigatório** | Já necessário para NF-e; reuso da infra Sprint 17 |

## Decision

Adotar **abordagem híbrida progressiva** — NFS-e Nacional como **provider complementar** ao Focus NFe, **não substituto**. Manter [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) intacto: Focus continua único provider obrigatório no MVP.

### Princípio orientador

> **NFS-e Nacional é um caminho de redução de custo, não uma virada arquitetural.** Nunca substitui Focus NFe; complementa para tipos e municípios onde economia é significativa.

### Quando ativar (gatilhos)

NFS-e Nacional **não entra no MVP**. Entra quando **TODOS** os gatilhos abaixo forem verdadeiros:

| # | Gatilho | Como medir |
|---|---|---|
| 1 | Sprint 36 entregue e estável | `fiscal_focus_v1` em produção há ≥3 meses sem incidente fiscal |
| 2 | Volume agregado ≥ 10.000 NFS-e/mês | `count(*) FROM fiscal_emissions WHERE kind='nfse'` no mês anterior |
| 3 | ≥30% das emissões em municípios aderidos | Cross-check `municipality_code` × lista nacional aderida |
| 4 | Pelo menos 1 tenant Business/Enterprise sinalizou custo fiscal como dor | Feedback comercial registrado |

Se gatilhos atingidos, abrir **Sprint dedicado** (estimativa: 36c — "NFS-e Nacional integration", 2-3 semanas) reusando a interface `FiscalProvider` já existente (ADR 0059).

### Arquitetura prevista (quando ativar)

A interface `FiscalProvider` em [ADR 0059:59-77](0059-ciclo-fiscal-emissao-focus-nfe.md) já é abstrata por design. O plugin entra como **provider adicional**, não substituto:

```
packages/ai/fiscal/
  provider.ts                     # Interface FiscalProvider (sem mudança)
  providers/
    focus-nfe.ts                  # Atual — único provider obrigatório
    nfse-nacional.ts              # NOVO — só implementa emitNfse + cancel + queryStatus
    mock.ts                       # Atual
  routing/
    nfse-router.ts                # NOVO — escolhe provider por município:
                                  #   se municipality_code ∈ aderidos_nacional → 'nfse_nacional'
                                  #   senão → 'focus_nfe'
```

### Roteamento (regra simples)

```ts
function pickNfseProvider(emission: NfseInput): 'nfse_nacional' | 'focus_nfe' {
  if (emission.kind !== 'nfse') return 'focus_nfe';            // outros tipos → sempre Focus
  if (emission.eventKind === 'cancel' || emission.eventKind === 'cce') {
    return providerThatEmitted(emission.parentChave);          // evento sempre no provider que emitiu
  }
  if (NFSE_NACIONAL_ADHERED_MUNICIPALITIES.has(emission.companyMunicipalityCode)) {
    return 'nfse_nacional';
  }
  return 'focus_nfe';                                           // fallback default
}
```

Lista `NFSE_NACIONAL_ADHERED_MUNICIPALITIES` mantida em `packages/ai/fiscal/data/nfse-nacional-adherence.json`, atualizada via job mensal (`/api/jobs/sync-nfse-nacional-adherence`) que consulta a fonte oficial gov.br.

### Schema (acréscimos quando ativar)

```sql
-- Em fiscal_emissions (já existe — Sprint 15):
ALTER TABLE fiscal_emissions ADD COLUMN provider text NOT NULL DEFAULT 'focus_nfe'
  CHECK (provider IN ('focus_nfe', 'nfse_nacional', 'enotas', 'mock'));

-- Tabela nova: aderência municipal
nfse_nacional_municipalities
  ibge_code text pk                  -- código IBGE 7 dígitos
  municipality_name text
  uf char(2)
  adhered_since date
  layout_version text                 -- 'v1.0', 'v1.1', ...
  endpoint_url text                   -- ADN do município
  active bool default true
  imported_at timestamp
```

### Configuração por tenant

`/app/settings/fiscal` (Sprint 36) ganha toggle adicional **quando este ADR ativar:**

```
[ ] Usar NFS-e Padrão Nacional quando município aderido (recomendado — gratuito)
    └─ Status: município de São Paulo (3550308) — aderido desde 2024-08-01 ✅
       Estimativa de economia: ~R$ X/mês baseado no histórico
```

Default = ligado quando flag global `nfse_nacional_v1` estiver `on`. Tenant pode forçar Focus em todos os casos (caso de paranoia ou contrato exclusivo com Focus).

### Migração de tenant existente

- **Não há migração retroativa** — emissões já feitas via Focus permanecem; eventos (cancel/CC-e) sempre no provider que emitiu
- **Cutoff é por nova emissão** — primeiro mês após ativação roteia novas notas pro provider escolhido
- **Reconciliação contábil** mostra emissões por provider em `/app/contador/fiscal-emissions` para o contador externo

### Custo estimado da implementação

| Item | Esforço |
|---|---|
| Implementar adapter `nfse-nacional.ts` (emit + cancel + query) | 1 semana |
| Job de sync de municípios aderidos | 2 dias |
| Routing + flag + UI toggle | 3 dias |
| Testes E2E em ambiente homologação ADN | 3 dias |
| **Total** | **~2-3 semanas (Sprint 36c)** |

Sem mudança no Focus NFe; sem refactor de schemas; sem mudança em UI principal de emissão.

## Consequences

### Positivas

- **Redução de custo unitário** — emissões em municípios aderidos saem de R$ 0,15-0,50 para R$ 0
- **Menor lock-in com Focus** — provider gratuito alternativo reforça poder de barganha em renegociação
- **Cobertura aumenta gradualmente** — quanto mais municípios aderirem ao padrão nacional, mais economia automática
- **Risco regulatório mínimo** — provider oficial federal, infraestrutura governamental
- **Reuso da arquitetura** — `FiscalProvider` interface já existe, sem refactor
- **Tenants em capitais ganham mais** — alto volume + alta probabilidade de adesão municipal

### Negativas (mitigáveis)

- **Manutenção do layout nacional** — LogiFit precisa acompanhar Notas Técnicas do padrão nacional (mitigado: ritmo bem mais lento que SEFAZ; ~1-2 NTs/ano)
- **Dependência de aderência municipal** — se município sair do padrão nacional, fallback automático para Focus (regra de roteamento já cobre)
- **Suporte gov.br vs SLA Focus** — incidentes no ADN podem afetar emissão; mitigado: fallback automático para Focus se ADN retornar erro persistente (3 tentativas)
- **Tabela `nfse_nacional_municipalities` desatualizada** — job mensal pode falhar; mitigado: stale > 60 dias dispara `system_alerts` (regra 33)

### Riscos não endereçados

- **Padrão nacional ser descontinuado/refatorado** — improvável (lei federal), mas se acontecer, fallback para Focus continua funcionando
- **Município mudar de adesão silenciosamente** — job de sync precisa lidar com casos limítrofes; aceitar 1 mês de defasagem é tolerável
- **Tenant com contrato Focus que exige exclusividade** — toggle por tenant mitiga; default off para enterprise se Focus negociou desconto exigindo volume

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Substituir Focus NFe pela NFS-e Nacional** | Cobertura municipal incompleta; Focus continua necessário para NF-e/NFC-e/eventos; risco operacional alto |
| **Construir motor fiscal próprio** (tudo do zero) | Avaliada e rejeitada explicitamente em conversa 2026-04-25 — escopo de 8-12 meses solo, manutenção eterna, risco regulatório alto. Ver alternativa proposta D em conversa de planejamento |
| **Esperar até 100% de adesão municipal** | Pode nunca acontecer (adesão voluntária); deixa economia sobre a mesa |
| **Implementar agora no MVP** | Distrai do caminho crítico; ganho marginal antes do volume justificar |
| **Multi-provider load balanced** (Focus + eNotas + Nacional) | Complexidade alta para benefício marginal; deferido |

## Escopo de impacto

**Novo ADR:** este (0076). [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) **não é alterado** — mantém Focus como único obrigatório. [ADR 0066](0066-plano-comercial-pricing-trial.md) é atualizado em paralelo para corrigir modelo de custo fiscal.

**Sprints ajustados:**

- **Sprint 36** (Focus NFe) — adiciona seções:
  - `## Stretch` ganha item "Preparar `FiscalProvider` para suportar `nfse-nacional` no futuro (sem implementar)"
  - **Negociação com Focus NFe** — abrir conversa comercial pré-Sprint 36 para tabela escalonada por volume (target: R$ 0,08-0,12/nota acima de 10k/mês)
- **Novo Sprint 36c** (futuro, condicional) — "NFS-e Nacional integration" quando gatilhos atingidos

**Docs:**

- `CHANGELOG.md` — entrada
- `docs/comercial.md` — slide "fiscal NFS-e nacional" referenciado, mas não vendido como diferencial até estar entregue
- `docs/roadmap.md` — Sprint 36c condicional adicionado em "Sprints futuros / condicionais"

**Sem mudança em:**

- `docs/rules.md` — nenhuma regra dura nova
- `docs/arquitetura.md` — provider plugável já documentado
- `CLAUDE.md` — Focus NFe continua canônico no MVP

## Related

- Depende de [ADR 0059 — Ciclo fiscal Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) — interface `FiscalProvider` reusada
- Relacionado a [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — modelo de custo fiscal e overage por nota
- Relacionado a [ADR 0073 — Postura de segurança](0073-postura-seguranca-defesa-em-profundidade.md) — `safeFetch` para chamar ADN; certificado A1 cifrado por tenant (camada 4)
- Fontes consultadas: Portal NFS-e Nacional (gov.br), CNM (Confederação Nacional de Municípios), notas técnicas ABRASF, conversa de planejamento usuário ↔ Claude (2026-04-25)
