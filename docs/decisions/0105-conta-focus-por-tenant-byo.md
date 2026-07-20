# ADR 0105 — Conta Focus NFe por tenant (BYO), não revenda

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

O primeiro onboarding fiscal real (ESP TECNOLOGIA, Cascavel/PR) expôs uma contradição entre o modelo comercial documentado e o que o código implementa.

**O que os ADRs comerciais dizem.** O [ADR 0066](0066-plano-comercial-pricing-trial.md) cobra overage de NFS-e (R$ 0,50 / 0,40 / 0,35 / 0,25 por nota conforme tier) descrito como *"repasse calibrado sobre custo Focus NFe + margem operacional"*. O [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) repete na seção de consequências: *"custo por documento (~R$ 0,10-0,50 por NF emitida conforme Focus) — repassado ao tenant no plano"*. Repassar custo pressupõe que **a LogiFit é cliente da Focus** e revende.

**O que o código implementa.** `fiscal_provider_credentials` é por tenant e o wizard `/app/settings/fiscal` coleta apenas `api_token` + `environment`. Isto é, **cada tenant traz a própria conta Focus**. Nesse arranjo o tenant paga a Focus diretamente e a LogiFit não tem custo de emissão para repassar.

As duas leituras não podem ser simultaneamente verdadeiras.

Consequência prática observada em 2026-07-20: por o código presumir conta do tenant, o operador foi mandado ao painel da Focus para cadastrar `login_responsavel`/`senha_responsavel` do portal municipal — campos que ele não encontrou, porque o painel nem sempre os expõe. Num modelo de revenda esse passo seria da LogiFit, via API, dentro do nosso wizard.

## Decision

**Manter o modelo BYO (bring-your-own): a conta Focus NFe é do tenant.**

- `fiscal_provider_credentials` permanece por tenant, com o token do tenant cifrado AES-256-GCM (sem mudança de schema).
- A LogiFit **não** cria empresas na Focus (`POST /v2/empresas`) nem intermedeia o contrato.
- O tenant contrata a Focus, cadastra sua(s) empresa(s) lá e fornece o token ao LogiFit.

Motivos: é o que já funciona, evita que a LogiFit vire intermediária de contrato fiscal de terceiros, e mantém a LogiFit fora da cadeia de responsabilidade sobre credenciais de portais municipais e certificados A1 de clientes.

### Consequência que exige ação: ADR 0066 precisa de revisão

O overage de NFS-e **deixa de ser repasse de custo**, porque não há custo Focus na LogiFit. Continuar descrevendo-o como repasse é incorreto perante o cliente. Caminhos possíveis (decisão comercial pendente, fora do escopo deste ADR):

1. **Reenquadrar** como tarifa de plataforma pelo ciclo fiscal (fila, retry, reconciliação, auditoria, portal do contador) — o valor entregue existe e é independente do custo Focus.
2. **Remover** o overage de NFS-e e absorver a emissão na mensalidade do tier.

Enquanto não decidido, o texto do ADR 0066 e de [`docs/comercial.md`](../comercial.md) está impreciso quanto à natureza da cobrança.

### O que continua sendo responsabilidade do LogiFit

Mesmo com conta do tenant, o LogiFit deve reduzir o atrito de configuração — o painel da Focus não é uma boa experiência de onboarding e esconde campos essenciais:

- Perfis de integração por município ([`municipios-nfse.ts`](../../packages/ai/src/fiscal/municipios-nfse.ts)) — série de RPS, disponibilidade de homologação, suporte a cancelamento por webservice, exigência de credenciamento.
- **Pendente:** tela que empurra configuração de empresa para a Focus via `PUT /v2/empresas/{id}` (credenciais do portal municipal, inscrição municipal, série), quando o token do tenant tiver escopo de conta. **Repasse sem persistência**: enviar à Focus e gravar apenas `configurado_em` — a senha do portal municipal dá acesso a dados tributários e permite emitir em nome do contribuinte; é segredo que é melhor não guardar. Mesma regra para o `.pfx`.

## Consequences

### Positivas

- Zero mudança de schema e de código para manter o que já funciona.
- LogiFit fora da cadeia de custódia de certificados A1 e senhas de portais municipais de clientes — menos superfície de risco e de LGPD.
- Sem intermediação de contrato fiscal de terceiros.

### Negativas (mitigáveis)

- **Onboarding mais pesado para o tenant** — precisa contratar a Focus e cadastrar a empresa lá antes de usar o módulo fiscal. Mitigado pelos perfis municipais e pela tela de configuração pendente acima.
- **ADR 0066 fica impreciso** até a revisão comercial descrita acima. É a dívida aberta por esta decisão.
- **Suporte mais difuso** — problema de emissão pode estar no contrato do tenant com a Focus, fora do alcance do LogiFit. Mitigado por mensagens de erro que identificam a origem (ver `focus-nfe.ts`, prefixo do código de erro).

## Referências

- [ADR 0059](0059-ciclo-fiscal-emissao-focus-nfe.md) — ciclo fiscal via Focus NFe
- [ADR 0066](0066-plano-comercial-pricing-trial.md) — pricing (**a revisar**)
- [ADR 0076](0076-nfse-nacional-provider-complementar.md) — NFS-e Nacional como provider complementar
- Doc Focus: https://doc.focusnfe.com.br/reference/atualizar_empresa.md
