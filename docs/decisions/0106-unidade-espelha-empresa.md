# ADR 0106 — Unidade espelha a empresa: nível invisível enquanto for 1:1

- **Status:** Accepted
- **Date:** 2026-07-20

## Context

O [ADR 0006](0006-hierarquia-group-tenant-company-unit.md) define quatro níveis: `group → tenant → company → unit`. O `unit` é o local físico com endereço, filho de `company`.

Na prática, o nível nunca saiu do papel. Levantamento em 2026-07-20:

- **11 unidades** no banco, todas criadas pelo wizard de `/signup` (passo 5d) — nenhuma criada depois
- **nenhuma tela de gestão**: não existe rota, página nem Server Action de unidade; as outras telas só a consomem como `leftJoin` para exibir nome
- **0 de 74 members** com `home_unit_id`
- **0 recursos**, **0 papéis com `scope_unit_id`**
- **0 endereços com logradouro** — todas com `{uf, cidade}` do seed
- **exatamente 1 unidade por company** nas 11 companies existentes

O próprio [`multiempresa.md`](../multiempresa.md) já reconhecia a tendência: *"Loja avulsa = 1 tenant + 1 matriz + 1 unit"* e *"cliente modela como 1 matriz + N units"*.

Confrontado com isso, o fundador foi direto: **"unidade seria a empresa"**. É o modelo mental de quem opera — cadastra-se uma empresa e espera-se que o sistema saiba onde ela fica, sem um segundo nível para gerenciar.

## Decision

**Manter `units` no schema e torná-la invisível na interface enquanto a relação for 1:1.**

- Criar company cria a unidade correspondente, espelhando nome (fantasia, ou razão social se não houver) e endereço da `persons` vinculada.
- Editar o cadastro atualiza as duas — o operador preenche um formulário só, em Configurações → Empresas.
- O espelhamento (`apps/web/app/lib/company-unit.ts`) **só age quando a company tem 0 ou 1 unidade**. Company com 2+ saiu do caso 1:1 e passa a ser gerenciada manualmente; sobrescrever apagaria o trabalho do operador.

### Por que não colapsar de verdade

Excluir `units` seria coerente com o modelo mental, mas quebra coisas reais:

**12 tabelas referenciam `units`** — `members.home_unit_id`, `sales`, `accounts_payable`, `equipment`, `resources`, `access_devices`, `leads`, `cleaning_checklists`, `cleaning_logs`, e duas de autorização: `user_roles.scope_unit_id` e `user_permission_grants.scope_unit_id`.

**O escopo de permissão por unidade morreria.** O [`multiempresa.md`](../multiempresa.md) define `recepcao → unit:Y` e `fisio/nutri → unit:Y,Z (várias) dentro da mesma company`. Esse último caso exige que unidade exista separada de empresa: sem ela não há como dar a um fisioterapeuta acesso a duas unidades sem dar acesso à empresa inteira.

**Os casos 1:N são reais, só não são os nossos hoje.** Um CNPJ com sala administrativa e salão de treino em endereços diferentes; um estúdio que aluga espaço em três locais sob a mesma inscrição. Nenhum deles aparece no MVP, mas voltar atrás depois de apagar a tabela custa migration de 12 FKs.

A escolha é entre pagar complexidade de UI agora (esconder o nível) ou pagar migration depois (recriá-lo). Esconder é reversível; apagar não.

## Consequences

### Positivas

- O operador cadastra "a empresa" e pronto — sem nível extra, que era o pedido.
- `units` deixa de ser tabela morta: passa a ter nome e endereço reais, alimentados pelo cadastro da empresa.
- Nenhuma das 12 dependências muda; escopo de permissão por unidade continua possível quando for necessário.
- Reversível nos dois sentidos: se aparecer o caso 1:N, basta expor a gestão de unidades; se ficar provado que 1:1 é universal, aí sim vale discutir colapsar.

### Negativas (mitigáveis)

- **Duas fontes para o mesmo endereço** — `persons.address` (canônico) e `units.address` (espelho). Divergem se alguém escrever direto em `units` fora do `syncCompanyUnit`. Mitigado por o espelhamento ser o único caminho de escrita hoje; se surgir CRUD de unidade, ele assume a gestão e o espelhamento se desliga (2+ unidades).
- **`home_unit_id`, rateio por unidade e escopo de permissão seguem sem interface.** Este ADR não os destrava — só garante que a unidade existe e está correta quando forem implementados.
- **O nível continua no schema sem estar na UI**, o que pode confundir quem lê o banco antes de ler este ADR.

## Referências

- [ADR 0006](0006-hierarquia-group-tenant-company-unit.md) — hierarquia original (mantida; este ADR muda só a exposição na UI)
- [ADR 0047](0047-cadastro-central-persons.md) — `persons` como cadastro central (fonte do nome e endereço espelhados)
- [`multiempresa.md`](../multiempresa.md) — escopo de permissão por unidade
