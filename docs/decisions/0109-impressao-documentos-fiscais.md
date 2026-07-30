# ADR 0109 — Impressão de documentos fiscais (DANFE, DANFCE, DANFSE)

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

O [ADR 0108](0108-emissao-fiscal-propria-nfe-nfce-nfse.md) internaliza a **emissão**. Emissão termina na autorização do órgão — mas a operação real termina no **papel**: o cliente sai da academia com o cupom da NFC-e na mão, e a NF-e de revenda é anexada em e-mail ou processo.

Hoje o LogiFit não imprime nada fiscal. O PDF de DANFE/DANFSE vem pronto da Focus, hospedado no S3 dela, e o operador baixa e imprime pelo diálogo do navegador. Internalizada a emissão, o LogiFit passa a ser responsável por **desenhar o documento auxiliar** e por **colocá-lo na impressora certa**.

São dois problemas distintos, e confundi-los é a origem da maioria dos incidentes de campo:

1. **Layout** — onde cada dado aparece no papel, e como isso se adapta a A4 × bobina 80mm × 58mm
2. **Despacho** — como os bytes chegam a uma impressora física que está na mesa do recepcionista, não no servidor

O **Deep Control** (mesmo autor, fora deste repo) tem esse subsistema em produção, documentado com pipeline, invariantes e diagnóstico de falhas de campo. Serve de referência — mas **com uma divergência de contexto que muda a decisão**: o Deep Control é um PDV Windows instalado, com serviço local (`ControlPrintAgent` em `127.0.0.1:9223`), instalador Inno Setup, pdfium/wasm e GDI. O LogiFit é SaaS web self-hosted, sem instalador, com dev solo.

Copiar o serviço Windows seria portar ~2.000 linhas de Go, um instalador, rasterização pdfium e blit GDI — para um produto que hoje não instala nada na máquina do cliente.

## Decision

Adotar a **arquitetura de template do Deep Control** (que é agnóstica de plataforma) e **rejeitar o serviço local Windows** como ponto de partida, substituindo-o por um caminho web-nativo em três estágios.

### Princípio 1 — o backend entrega dados e modelo; quem desenha é o cliente

```
XML/JSON autorizado          fiscal_print_templates.schema
        │                              │
        ▼                              ▼
  buildTemplateData ──► inputs      schema (JSON)
        └────────────┬───────────────┘
                     ▼   GET /api/fiscal/emissions/{id}/print-bundle
              render no cliente ──► bytes de PDF ou ESC/POS
                     ▼
              destino (ver Princípio 3)
```

| # | Camada | Responsabilidade |
|---|---|---|
| 1 | **Dados** | Parsear o documento autorizado e produzir `inputs` já formatados em pt-BR |
| 2 | **Modelo** | Onde cada dado aparece, tamanho de página, fontes — configurável pelo cliente |
| 3 | **Render** | Reflow, encolhimento, geração dos bytes |
| 4 | **Despacho** | Escolher destino e entregar |

### Princípio 2 — o catálogo de variáveis é a fonte da verdade

A função que converte documento → `inputs` é **a** referência. O painel de variáveis mostrado ao cliente no editor é **cópia**. Adicionar variável no painel sem adicionar no catálogo produz string vazia no papel — falha silenciosa, papel gasto.

Consequência de design: o painel do editor é **gerado** do catálogo, não mantido em paralelo. Divergência vira erro de compilação, não bug de campo.

### Princípio 3 — despacho em três estágios, não um serviço Windows

| Estágio | Caminho | Cobre | Custo |
|---|---|---|---|
| **A — Diálogo do navegador** | Servidor gera PDF → `<iframe>` → `print()` | NF-e A4, reimpressão, portal do contador, qualquer impressora com driver | Zero instalação |
| **B — ESC/POS via WebUSB / Web Serial** | Navegador escreve direto na térmica, sem diálogo | **Cupom NFC-e no balcão**, auto-impressão pós-venda | Permissão única do usuário; Chromium apenas |
| **C — Agente local** | Só se o campo exigir | Impressora de rede sem USB, navegador não-Chromium, frota grande | Instalador + serviço — **não entra sem demanda real** |

O estágio B é a peça que torna o serviço Windows dispensável: **depois da permissão concedida uma vez, o navegador escreve na impressora sem diálogo** — que é exatamente a propriedade que motivou o serviço local no Deep Control (`auto_print_danfe`). Cupom fiscal é ESC/POS: texto, comandos e QR, sem rasterização. Não precisa de pdfium nem GDI.

O estágio C fica documentado como escape, com gatilho explícito: **só entra se um tenant real tiver impressora que não seja USB local**, e nunca antes disso.

### Invariantes portadas da referência

Cada uma existe por incidente real. Violá-las é repetir gasto de bobina em campo.

1. **Nunca cair de térmico para A4.** Se o alvo era 80mm e o render falhou, mostrar erro — não imprimir A4 na bobina. Cupom ilegível e bobina inteira desperdiçada.
2. **A largura decide a impressora.** `width < 150mm` ⇒ tratado como térmico (reflow + encolhimento + rota térmica).
3. **Lista dinâmica é `table`, nunca texto.** Campo de texto em posição absoluta não colapsa quando vazio — deixa buraco ou sobrepõe.
4. **Altura declarada não é altura real.** O reflow é estimado; subestimar imprime um bloco por cima do outro. Rótulo curto (`< 15mm`) cresce mas **nunca encolhe**; área longa (`≥ 15mm`) cresce e encolhe.
5. **Encolher a página descontando o padding.** Sem isso o último elemento cai fora da área útil e o gerador abre uma **segunda página** — bobina em branco no fim.
6. **Não deixar vão entre blocos em térmico.** O reflow desloca os campos de baixo só pelo *delta* do que cresceu, preservando o vão.
7. **Validador bloqueia salvar template sem os campos exigidos pelo órgão.** Resposta 400 com a lista exata do que falta, não erro genérico.
8. **Templates duplicados ativos resolvem por `ORDER BY updated_at DESC, id DESC`.** Sem isso o cupom alterna entre layouts a cada impressão.
9. **IDs de template determinísticos** (`md5(tenant_id || ':' || name)`), não `gen_random_uuid()`.
10. **Erro de impressão sempre visível** — `<Toast>` do catálogo da regra 45, nunca só `console.error`.
11. **Todo caminho de impressão passa por uma função única** — é onde vivem roteamento, hidratação de config e notificação.
12. **Portal do contador imprime o completo; o balcão imprime o configurado.** Usuário administrativo quer a versão anexável.
13. **ESC/POS precisa de sanitização ASCII** — térmica em CP437 não imprime acento UTF-8.

### O que não porta

| Item da referência | Motivo |
|---|---|
| `print-service/` (Go, Windows Service, `:9223`) | Estágio C, sob demanda |
| pdfium/wasm + GDI + blit + `PHYSICALOFFSET` + rotação 90° | Consequência do serviço local |
| Instalador Inno Setup + regra de firewall | Idem |
| `print-agent/` legado (Scheduled Task + Edge headless + SumatraPDF) | Morto na própria referência |
| `format=html` | Rejeitado na própria referência — gerar PDF |
| Documentos de combustível: encerrante, vale-combustível, DAMDFE/MDF-e | LogiFit não vende combustível nem transporta carga |
| PDV mobile Android (PAX/Gertec/Sunmi/Cielo) | Fora do MVP; app nativo é Fase 3 ([ADR 0045](0045-stack-mobile-expo-managed-react-native.md)) |

### Schema

```sql
fiscal_print_templates
  id uuid pk                       -- determinístico: md5(tenant_id || ':' || name)
  tenant_id uuid not null          -- regra 1 + RLS
  company_id uuid null             -- NULL = default do tenant; preenchido = override
  name text not null               -- SEMÂNTICO: a resolução por layout procura por nome exato
  doc_type text not null           -- 'danfe_a4' | 'danfe_termica' | 'danfce' | 'danfse' | 'recibo'
  schema jsonb not null            -- layout: posições, fontes, tabelas
  is_active bool not null default true
  updated_at timestamptz
  -- unique (tenant_id, doc_type, name) WHERE company_id IS NULL

fiscal_print_settings
  tenant_id uuid  company_id uuid  unit_id uuid
  nfe_print_layout text not null default 'completo'   -- 'completo' (A4) | 'simples' (80mm)
  auto_print bool not null default false
  thermal_width_mm int default 80                     -- 80 | 58
  primary key (tenant_id, company_id, unit_id)
```

Seleção de impressora vive na **máquina** (`localStorage` + registro da unidade), **nunca no perfil do usuário** — quem imprime é o balcão, não a pessoa logada. `localStorage` manda enquanto tiver valor; o registro da unidade só preenche buraco, porque `localStorage` é por origem e evapora quando o PDV abre por outra URL ou limpam dados do navegador.

### Resolução de template

1. Override da company/unit para o `doc_type`
2. Para NF-e: `fiscal_print_settings.nfe_print_layout` → `'simples'` busca o template térmico por nome, `'completo'` busca o A4; se o alvo não existe, tenta o outro (melhor layout errado que não imprimir)
3. Default do tenant para o `doc_type`
4. Nenhum ⇒ template embutido no build (canônico, imune a regressão de seed)

O passo 4 é correção sobre a referência: lá, template ausente devolve 404 e o cliente cai num gerador legado. Aqui o layout canônico é **embutido**, então "não imprimir" deixa de ser estado alcançável por dado ruim.

### Fases

| Fase | Escopo | Esforço | Gate |
|---|---|---|---|
| **A** | Catálogo de variáveis + templates canônicos embutidos (DANFE A4, DANFCE 80mm, DANFSE) + render server-side + impressão por diálogo | **2 sem** | Cupom de 1 e de 10+ itens sem sobreposição e sem bobina em branco; A4 confere com o Manual do órgão |
| **B** | ESC/POS via WebUSB/Web Serial + auto-impressão pós-venda + config de impressora por máquina | **1-2 sem** | Venda no balcão imprime sozinha após permissão única; acento correto; QR escaneável |
| **C** | Editor visual de template + validador de campos obrigatórios + override por company | **2 sem** | Salvar template sem campo obrigatório retorna 400 com a lista |
| **D** | *Condicional* — agente local | 3-4 sem | **Só com tenant real que tenha impressora não-USB** |

**Total A+B+C: 5-6 semanas.** Corresponde à Fase 6 do [ADR 0108](0108-emissao-fiscal-propria-nfe-nfce-nfse.md).

### Checklist de aceitação

Portado da referência, sem os itens de combustível:

- [ ] NFC-e de 1 item: sem bobina em branco no fim, QR escaneável, chave legível, total de tributos presente (Lei 12.741)
- [ ] NFC-e de 10+ itens: tabela com reflow, nada sobreposto, página única
- [ ] NFC-e sem CPF: `CONSUMIDOR NAO IDENTIFICADO`, não rótulo vazio
- [ ] NF-e com unidade em `completo`: A4 na impressora normal
- [ ] NF-e com unidade em `simples`: 80mm na térmica — e, se o render falhar, **toast de erro, não A4 na bobina**
- [ ] Reimpressão pelo histórico sai igual à primeira via
- [ ] Portal do contador: preview e download do A4 completo
- [ ] Máquina com `localStorage` limpo: re-hidrata do registro da unidade sem reconfiguração manual
- [ ] Ambiente de homologação imprime o aviso obrigatório; produção não imprime nada

## Consequences

### Positivas

- **Zero instalação** no cliente para o caminho principal — coerente com produto web
- **Auto-impressão de cupom sem serviço local**, via permissão única de dispositivo
- **Layout configurável pelo cliente** sem release
- **Template canônico embutido** — "não imprimir" deixa de ser alcançável por dado ruim
- **13 invariantes de campo** herdadas sem pagar os incidentes

### Negativas

- **Estágio B é Chromium-only.** Firefox e Safari não têm WebUSB/Web Serial — nesses navegadores, cupom só por diálogo, sem auto-impressão. Precisa estar dito na UI, não descoberto pelo operador
- **Impressora de rede sem USB não é coberta** até o estágio C
- **Editor visual é superfície nova de suporte** — cliente desenha template quebrado e culpa o sistema; o validador cobre o obrigatório, não o estético
- **Manutenção de layout por mudança de manual** do órgão

### Riscos não endereçados

- **WebUSB pode ser restringido por política de navegador corporativo** — sem plano B além do estágio C
- **Papel errado não gera erro**, gera papel errado. A escolha de template é silenciosa por construção; mitigação é o log de qual template resolveu em cada impressão

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Portar o serviço Windows do Deep Control** | ~2.000 linhas de Go + instalador + pdfium + GDI, para um produto que não instala nada. Fica como estágio C sob demanda |
| **Só diálogo do navegador** | Sem auto-impressão, o balcão clica em diálogo a cada venda — inviável em volume |
| **QZ Tray ou equivalente** | Dependência externa paga; exigiria ADR sob a regra 46 sem resolver nada que o estágio B não resolva |
| **Renderizar no servidor e mandar direto à impressora** | O servidor não enxerga a impressora do balcão. Fisicamente impossível sem agente |
| **Layout fixo em código, sem editor** | Toda mudança de logo ou de campo vira release |
| **Reaproveitar só `react-pdf`** (já usado em memorial fiscal) | Serve para documento fixo; não dá editor visual nem schema como dado |

## Escopo de impacto

**Sprint:** 45 (Fase 6 do ADR 0108).

**Regras:** nenhuma regra nova. Aplicam-se a **45** (erro de impressão via `<Toast>`, proibido dialog nativo), **27** (UI em 3 locales; o *documento fiscal* é sempre pt-BR por exigência legal), **1** (`tenant_id` + RLS nas duas tabelas novas).

**Docs:** `CHANGELOG.md`, `docs/roadmap.md`, `docs/modulos.md`, runbook de configuração de impressora em `docs/runbooks/`.

## Related

- Irmão de [ADR 0108 — Emissão fiscal própria nacional](0108-emissao-fiscal-propria-nfe-nfce-nfse.md); é a Fase 6 dele
- Consome [ADR 0101 — POS vendas](0101-pos-vendas-schema.md) (venda de balcão → cupom)
- Sujeito à regra 45 ([ADR 0089 — Sistema de mensagens](0089-sistema-mensagens-padronizadas.md))
- **Implementação de referência:** subsistema de impressão do Deep Control (Go + print-service Windows + pdfme, fora deste repo) — pipeline, invariantes e diagnóstico de campo
