# Protótipo de telas — LogiFit

Protótipo **estático** (HTML + CSS + Inter via Google Fonts) pra iterar em design antes de tocar o app Next.js real. Filosofia "Equilíbrio Vital" aplicada nos tokens de `tokens.css`.

## Como rodar

Via Claude Preview:

```
preview_start name="prototipo"
```

A config já está em `.claude/launch.json` (sobe `npx serve` em `:3001` apontando para esta pasta).

Alternativa manual (sem Claude Preview):

```bash
npx serve -p 3001 -L prototipo
```

Abra `http://localhost:3001/` — é o hub com índice de telas + swatches de tokens.

## Estrutura

```
prototipo/
├── README.md
├── index.html             # hub: navegação entre telas + swatches de tokens
├── tokens.css             # design tokens "Equilíbrio Vital" (light + dark)
├── base.css               # reset, tipografia, primitives (btn, card, badge, input, table)
├── app-shell.css          # layout topbar + sidebar + main (compartilhado pelas telas logadas)
├── theme.js               # toggle de tema light/dark (persiste em localStorage)
└── telas/
    └── 07-dashboard.html  # Sprint 07 · home do gerente
```

## Princípios

- **Flat Design extremo.** `box-shadow: none !important` em tudo. Elevação é feita com borda 1px, não sombra.
- **Tipografia Inter.** Apenas uma fonte. Hierarquia vem de tamanho + peso + cor.
- **Paleta fechada.** Só cores definidas em `tokens.css`. Nenhum valor hex hard-coded fora dele.
- **Sem framework.** Zero build, zero dependência. HTML + CSS puro; `<script>` só pro theme toggle.
- **Tradução posterior.** Quando uma tela é aprovada, convertemos pra shadcn + Tailwind v4 em `apps/web/` (MVP real).

## Adicionar uma nova tela

1. Criar `telas/NN-nome-da-tela.html` copiando o scaffolding de `07-dashboard.html`.
2. Importar `../base.css` e `../app-shell.css`.
3. Adicionar link no `index.html` trocando `screen-card--todo` por link real.
4. Rodar `preview_start name="prototipo"` e iterar com `preview_screenshot`.

## Este protótipo NÃO é código de produção

- Nenhum arquivo daqui vai para `apps/web/` direto.
- Não há RLS, não há i18n, não há Zod, não há nada das 29 regras duras.
- Servir como **referência visual** pra quando o sprint real começar — aí traduzimos pra shadcn/Tailwind no monorepo.
