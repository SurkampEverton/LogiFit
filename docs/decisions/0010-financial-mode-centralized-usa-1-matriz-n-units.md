# ADR 0010 — `financial_mode=centralized` usa "1 matriz + N units", sem schema separado

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O tenant tem flag `financial_mode ∈ {centralized, distributed}` (ver [ADR 0007](0007-topology-owned-vs-franchise.md)):

- **`distributed`**: cada `company` tem CNPJ próprio, conta Asaas própria, emite NF-e própria.
- **`centralized`**: só uma pessoa jurídica é fiscalmente ativa; filiais seriam só operacionais.

A pendência declarada no [roadmap](../roadmap.md) (item "Decisões pendentes") era: em `centralized`, modelamos como **(A)** 1 tenant com apenas 1 `company` matriz + N `units` (sem filiais), ou **(B)** tabela separada de "perfil fiscal" ligada ao tenant quando centralized e ligada à company quando distributed?

A decisão precisa fechar antes do Sprint 01a, porque define o schema de `companies`, `units` e `fiscal_*`.

## Decision

Adotamos a opção **(A)**: em `financial_mode=centralized`, o tenant tem **exatamente 1 `company` do tipo `matriz`** + **N `units`**, sem nenhuma `company` do tipo `filial`.

- A regra 21 (ver [rules.md](../rules.md)) já exige "exatamente 1 matriz por tenant" e permite 0..N filiais. Cabe naturalmente.
- Toda coluna fiscal (CNPJ emissor, conta Asaas, chave de integração fiscal) fica em `companies`.
- A `company matriz` é o único emissor. `units` são locais físicos sem papel fiscal.
- Transição `centralized → distributed` = `INSERT INTO companies (type='filial', ...)` + ajuste da flag. Zero migração destrutiva.
- Transição `distributed → centralized` exige consolidação manual (mover operação das filiais para a matriz, depois removê-las) — rara em prática, aceita como "operação administrativa".

Rejeitada a opção (B) por três motivos:

1. Duplica schema fiscal (uma versão ligada ao tenant, outra à company) — duas formas de fazer a mesma coisa.
2. Quebra a homogeneidade que [ADR 0009](0009-loja-avulsa-nao-vira-nivel-proprio.md) defende ("schema único cobre todos os casos").
3. Transição orgânica de avulsa → rede → multi-CNPJ é `INSERT`, não migração; (B) transforma em migração.

## Consequences

- Schema de `companies`/`units` continua simples e homogêneo; regra 21 já protege a invariante.
- UI de onboarding do tenant `centralized` esconde a palavra "matriz" (é a única company; aparece como "Dados fiscais da empresa"). Trabalho de design, não de modelagem.
- Relatório DRE consolidado em `centralized` é trivial (uma company só). Em `distributed`, vira soma de N companies — já previsto.
- Qualquer coluna nova fiscal/financeira vai em `companies`, nunca em `tenants`. Vale como regra tácita: "dados fiscais moram em company, nunca em tenant".
- `units` nunca ganha CNPJ nem conta Asaas — permanece 100% operacional.
