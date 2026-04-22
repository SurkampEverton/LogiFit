# ADR 0007 — Topology híbrida (owned vs franchise) + flags no tenant

- **Status:** Accepted
- **Date:** 2026-04-22

## Context

O produto precisa atender tanto **redes próprias** (mesmo dono controla todas as unidades) quanto **franquias** (unidades têm donos distintos, compartilham só a marca). Essas duas topologias têm requisitos legais e operacionais incompatíveis: em rede própria o admin da matriz vê tudo; em franquia, um franqueado não pode ver dados operacionais do outro.

Além disso, o financeiro pode ser **centralizado** (um CNPJ emite tudo) ou **distribuído** (cada filial tem CNPJ próprio e conta Asaas própria), e a mobilidade de aluno entre unidades varia por produto.

## Decision

Três flags configuráveis em `tenants` definem o comportamento da rede:

| Flag | Valores | Efeito |
|---|---|---|
| `topology` | `owned` \| `franchise` | Define se matriz tem scope operacional automático nas companies-filhas (`owned`) ou se cada filial é autônoma (`franchise`) |
| `financial_mode` | `centralized` \| `distributed` | Se centralized, só 1 company fiscal ativa; se distributed, N companies com CNPJ/conta Asaas próprios |
| `cross_company_access` | `true` \| `false` | Se aluno pode fazer check-in em qualquer unit da rede ou só na company onde matriculou |

Cenários canônicos (obrigatórios no seed de dev/teste):

1. **Rede própria:** `owned` + `distributed` + `cross=true`
2. **Franquia clássica:** `franchise` + `distributed` + `cross=false`
3. **Franquia com passaporte:** `franchise` + `distributed` + `cross=true` com `franchise_agreements`
4. **Mix loja avulsa + rede no mesmo group:** dois tenants configurados diferentemente, agrupados por `group_id`

Implicações principais em `franchise`:

- Admin de matriz **não** tem scope automático nas companies-filhas; só vê agregados anonimizados.
- **Dado clínico nunca cruza `company_id`** em franchise, nem com consent (regulatório CFM/CREFITO/CRN).
- `franchise_agreements` define condições de mobilidade cross-company (split de billing, autorização bilateral).

## Consequences

- Uma flag resolve várias topologias de mercado sem fork de produto.
- Seed de testes precisa cobrir os 4 cenários — se um quebra, CI vermelho.
- Onboarding fica mais rico (quiz decide flags); documentação do produto precisa ser clara.
- Mudança de flag depois de dados carregados é migração traumática — documentar como "escolha inicial, não muda".
