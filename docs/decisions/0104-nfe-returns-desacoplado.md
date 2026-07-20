# ADR 0104 — nfe_returns desacoplado da inbox de NF-e recebida

- **Status:** Proposed
- **Date:** 2026-07-20
- **Sprint:** 17b (débito #2 da auditoria do Sprint 36b — último da lista)

## Context

O [ADR 0058](0058-devolucao-de-compra-nfe.md) especificou `nfe_returns` com `nfe_received_id uuid not null fk nfe_received` — assumindo que a inbox de NF-e recebidas (ADR 0056, Sprint 17) já existiria.

A auditoria de 2026-07-20 mostrou que **nenhuma das duas nasceu**: nem `nfe_returns` (débito #2) nem `nfe_received` (a tabela que ele referenciaria). Só existe `nfe_sefaz_cursors`. Ou seja, o débito tinha uma dependência em cascata — implementá-lo "como especificado" exigiria antes construir toda a recepção de NF-e (download SEFAZ, manifestação do destinatário, parsing de XML), que é o escopo inteiro do Sprint 17.

Enquanto isso, o ciclo de emissão do ADR 0059 fica com um buraco: **NF-e de devolução** é 1 dos 8 tipos e não tem fonte.

## Decision

Criar `nfe_returns` **desacoplado**, com a chave da nota original como dado primário em vez de uma FK:

- **`original_chave text NOT NULL`** (44 dígitos, CHECK de formato) — é o que o layout NF-e realmente exige (`refNFe` no grupo de notas referenciadas). O operador digita a chave da nota que está devolvendo; ela está no DANFE que veio com a mercadoria.
- **`nfe_received_id uuid NULL`** — sem FK por ora; quando o Sprint 17 criar a tabela, uma migration adiciona a constraint e faz o backfill casando por chave. O campo já existe pra não exigir alteração de schema depois.
- `original_supplier_name` + `original_supplier_document` — capturados na criação, já que sem a inbox não há de onde derivar o emitente.

Demais campos seguem o ADR 0058: `kind` (total/parcial), `items jsonb`, `return_amount_cents`, `reason_category` + `reason_description` (≥20 chars), ciclo de status, e os campos de emissão externa.

**Emissão** (`emitNfeReturn`): monta o payload com `finNFe=4` + `notas_referenciadas: [{chave_nfe: original_chave}]` + CFOP de devolução resolvido pelo `cfop-resolver`, reusando o builder de NF-e do Sprint 36b. `fiscal_emissions.source_kind='nfe_return'`.

**Ciclo simplificado vs ADR 0058**: os estados `awaiting_external_emission` / `confirmed_by_supplier` / `rejected_by_supplier` pressupõem o fluxo de importação de XML da inbox. Como a emissão agora é própria (via Focus), o MVP usa `draft → emitted → cancelled`; os estados de conciliação com fornecedor entram junto com o Sprint 17.

## Alternatives considered

- **Construir `nfe_received` primeiro** — rejeitado: é o Sprint 17 inteiro (SEFAZ + manifestação + parsing), desproporcional pra destravar um tipo de emissão. Vira dependência artificial.
- **FK obrigatória com tabela stub** — rejeitado: tabela vazia só pra satisfazer FK é dívida disfarçada; e o operador ficaria obrigado a cadastrar a NF recebida antes de devolver.
- **Só `original_chave`, sem o campo `nfe_received_id`** — rejeitado: adicionar coluna depois é migration a mais; o campo nullable custa nada agora.

## Consequences

- Devolução funciona **sem depender do Sprint 17** — operador digita a chave e emite.
- Quando o Sprint 17 chegar: migration adiciona a FK, faz backfill por chave, e a UI passa a oferecer o botão "Devolver" direto na linha da NF recebida (como previa o ADR 0058).
- Risco aceito: chave digitada errada só é detectada na rejeição da SEFAZ. Mitigação no MVP é o CHECK de 44 dígitos; validação de DV da chave fica pra fase 2.
