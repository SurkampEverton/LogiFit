---
slug: tuss-update-pipeline
status: proposed
date: 2026-05-17
---

# ADR 0030 — Pipeline de atualização semestral da terminologia TUSS

## Contexto

A ANS publica atualizações de terminologia TUSS **semestralmente** (jan + jul de cada ano) via Ofícios-Circulares. Cada release pode incluir:
- Novos códigos de procedimentos
- Atualização de descrições
- Códigos depreciados (vigência encerrada)
- Novos OPME (órteses/próteses) — release jan/2026 trouxe +26k termos
- Novos medicamentos — release jan/2026 adicionou +334
- Novas tabelas de glosa

LogiFit precisa absorver essas mudanças **sem quebrar guias antigas**, **sem exigir dev hands-on a cada release**, e **rastreando auditavelmente** o que mudou.

## Decisão

### 1. Tabela `tuss_catalog_imports` com audit append-only

```sql
CREATE TABLE tuss_catalog_imports (
  id uuid PRIMARY KEY,
  version text NOT NULL,                    -- '2026.07' etc
  source tuss_import_source NOT NULL,        -- 'ans_oficio_circular' | 'manual'
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by_user_id uuid REFERENCES users(id),
  items_added int NOT NULL DEFAULT 0,
  items_updated int NOT NULL DEFAULT 0,
  items_deactivated int NOT NULL DEFAULT 0,
  import_log text                            -- log detalhado do diff
);
```

Unique `(version, source)` — cada release vem 1× do canal oficial.

### 2. Job semestral `tuss-update-job` (Sprint 22b cron)

Pseudocódigo:
```ts
async function tussUpdateJob(version: string): Promise<TussImport> {
  // 1. Baixa dump oficial ANS (XLSX ou XML) — URL configurável
  const ansData = await fetchAnsDump(version)

  // 2. Compara com tuss_catalog vigente
  const existing = await db.select().from(tussCatalog).where(eq(tussCatalog.active, true))
  const { adds, updates, deactivations } = diffCatalog(existing, ansData)

  // 3. Aplica em transação
  await db.transaction(async (tx) => {
    for (const item of adds) {
      await tx.insert(tussCatalog).values({...item, version, active: true})
    }
    for (const item of updates) {
      // Adiciona nova versão SEM deletar a antiga (rastreabilidade)
      await tx.insert(tussCatalog).values({...item, version, active: true})
    }
    for (const code of deactivations) {
      // Marca versão anterior como inactive
      await tx.update(tussCatalog).set({active: false}).where(...)
    }
    await tx.insert(tussCatalogImports).values({
      version,
      source: 'ans_oficio_circular',
      itemsAdded: adds.length,
      itemsUpdated: updates.length,
      itemsDeactivated: deactivations.length,
    })
  })

  // 4. Notifica admin via system_alerts
  await emitAlert('tuss.update_completed', { version, adds: adds.length })
}
```

### 3. Cronograma operacional

- **Janeiro:** Ofício-Circular ANS nº 1/AAAA publica até 15/jan; LogiFit roda job até 20/jan
- **Julho:** Ofício-Circular ANS nº X/AAAA publica até 15/jul; LogiFit roda job até 20/jul

Admin LogiFit revisa `tuss_catalog_imports` semanal pra confirmar import OK. Falha dispara `system_alerts critical`.

### 4. Decisão sobre downloads

**Aceito:** download manual via admin UI `/super-admin/tuss/import` no MVP. Admin baixa XLSX da ANS, faz upload, sistema processa.

**Rejeitado:** scraping automático do site ANS. Motivos:
- ANS frequentemente muda layout do portal
- Sem API oficial = web scraping = fragilidade
- Volume baixíssimo (2×/ano) — automação não compensa overhead

**Futuro (Sprint 22b+):** se ANS publicar API REST, migra para automação. Hoje, manual.

### 5. Bridge entre versões

Guias geradas com `tuss_version='2026.01'` continuam exibindo descrição da versão 2026.01 mesmo após upload de 2026.07. Query consome `(code, version)` PK composta.

UI `/app/catalogos/tuss` mostra versão vigente; histórico via `tuss_catalog_imports`.

## Consequências

### Boas
- Janela operacional clara (2×/ano) — sem precisar manter scraping
- Auditoria forte via `tuss_catalog_imports`
- Bridge histórico funciona — guias antigas legíveis em 20 anos
- Imports falhos não corrompem catalog vigente (transação)

### Ruins
- Manual no MVP — depende de admin LogiFit lembrar de rodar
- Upload XLSX é processo pesado (~30s no MVP) — ok pra 2×/ano

### Riscos
- ANS atrasa publicação do Ofício → tenants ficam com terminologia velha em janeiro/julho seguinte. Mitigação: validador proativo Sprint 22 (ADR 0031) checa `tuss_catalog.version` e avisa se já > 7 meses.
- Mudança disruptiva na ANS (TISS 5.0 futuro): pipeline reusa via novo `version` namespace; schema atual já suporta.

## Status

**Proposed.** Promove para **Accepted** quando primeira import real for executada com sucesso (provavelmente release jul/2026).

## Referências

- [ADR 0079](0079-tiss-401-ans-padrao-vigente.md) — estratégia geral
- [ADR 0029](0029-tiss-tuss-schema-xml-generator.md) — schema (PK composta `(code, version)`)
- Sprint 22 [`docs/sprints/22-fisio-tiss-tuss-convenios.md`](../sprints/22-fisio-tiss-tuss-convenios.md)
