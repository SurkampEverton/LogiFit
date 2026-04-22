# ADR 0009 — Loja avulsa usa o mesmo modelo (matriz obrigatória, filial opcional)

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

Grande parte dos clientes potenciais do LogiFit são **lojas avulsas** — uma única academia, uma clínica independente, um nutri autônomo. Havia a tentação de criar um nível simplificado (ex: "standalone") para esses casos, evitando que o cliente pequeno enfrente a complexidade de "tenant → matriz + filial".

## Decision

**Loja avulsa não ganha nível próprio.** O modelo existente já cobre:

- Loja avulsa = 1 `tenant` com **1 `company` `type=matriz`** + **1 `unit`**.
- Constraint no banco: "exatamente 1 matriz por tenant". Filial é opcional (0..N).
- Do ponto de vista do usuário final, a UI pode esconder a palavra "matriz" quando só há uma company — mas o schema permanece homogêneo.

Várias lojas do mesmo dono resolvem-se por árvore de decisão:

| Situação | Modelagem |
|---|---|
| Alunos circulam, agenda compartilhada, operação integrada | **1 tenant, N companies** — rede com múltiplos CNPJs, `cross_company_access=true` |
| Negócios independentes operacionalmente, dono quer só ver consolidado | **N tenants, mesmo `group`** — isolamento total, agregação no dashboard |
| Em dúvida | **N tenants, mesmo `group`** (mais conservador; unir depois é fácil, separar depois é impossível) |

## Consequences

- **Schema único** cobre lojas avulsas, redes, franquias, holdings. Zero fork de código.
- **Crescimento orgânico é `INSERT`** — loja avulsa vira rede inserindo nova `company type='filial'`; não migra dados.
- **Onboarding simples no MVP** — cliente cria tenant, sistema pré-cria matriz + unit padrão; só exibe campos de filial se houver mais de uma unidade.
- **Trade-off:** UX de cadastro inicial precisa esconder termos técnicos ("matriz", "tenant", "company") de clientes pequenos. Aceitável — é trabalho de design, não de modelagem.
