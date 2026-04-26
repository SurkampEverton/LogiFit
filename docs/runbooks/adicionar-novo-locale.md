# Runbook — adicionar um novo locale (idioma) ao LogiFit

> Procedimento canônico para adicionar um locale BCP-47 (ex: `de-DE`, `fr-FR`, `it-IT`, `ja-JP`) ao LogiFit sem refactor de código. Toda a arquitetura i18n ([ADR 0052](../decisions/0052-i18n-tres-idiomas-pt-en-es.md)) foi construída para que adicionar locale seja **runbook mecânico**, nunca trabalho de engenharia.

- **Quando usar:** decisão comercial/produto de oferecer LogiFit em um idioma adicional aos 3 já suportados (pt-BR / en-US / es-419)
- **Severidade típica:** p2 (mudança de produto agendada, não emergência)
- **Tempo estimado:** 4-8 horas de execução técnica + N dias de revisão humana das traduções
- **Quem executa:** dev (técnico) + revisor nativo do idioma (linguístico) + DPO (se mercado novo trouxer regulamentação não-LGPD — `ALTO`, ver §Pré-requisitos)
- **Última revisão:** 2026-04-25 (esqueleto inicial — Sprint 00)

## Pré-requisitos

- [ ] Acesso ao repo `logifit/logifit` com permissão de push em `main`
- [ ] MFA recente (<15min) — gate `requireRecentMfa()` **N/A** aqui (mudança de docs/config + migration trivial; não é high-risk action — regra 43)
- [ ] Anthropic API key configurada em `.env` (script `i18n:translate` consome)
- [ ] Backup recente confirmado (RPO 24h — regra 40) — só relevante quando rodar migration de `CHECK` constraint em produção (passo 7)
- [ ] **Decisão de mercado documentada:** o novo locale é apenas **i18n** (UI traduzida, regulamentação BR continua) ou **l10n completa** (novo mercado, novo país)?
  - Se **i18n apenas** → este runbook é suficiente
  - Se **l10n completa** → este runbook **não basta**; precisa de novo ADR cobrindo: documento PF/PJ do país (DNI/SSN/CURP/etc), gateway internacional, regulamentação local (GDPR/HIPAA/etc), fiscal local, moeda base ≠ BRL. Ver [ADR 0052 §Fora de escopo](../decisions/0052-i18n-tres-idiomas-pt-en-es.md). Pare aqui e abra ADR antes de continuar.
- [ ] Revisor humano nativo do idioma alvo identificado (interno LogiFit ou contratado) — tradução IA sem revisão é proibida em release (ADR 0052 §Decision)
- [ ] Layout RTL? (árabe `ar-SA`, hebraico `he-IL`, persa `fa-IR`) — se sim, este runbook **não basta**; abrir spike de Tailwind RTL plugin + auditoria visual completa de todos componentes antes de continuar. LTR adicional (latino, cirílico, greco) cabe no runbook.

## Passos

### 1. Atualizar `packages/i18n/config.ts` — `LOCALES` array

```ts
// packages/i18n/config.ts
export const LOCALES = ['pt-BR', 'en-US', 'es-419', 'de-DE'] as const // ← adicionar
export type Locale = (typeof LOCALES)[number]
```

`FALLBACK_CHAIN` permanece `['en-US', 'pt-BR']` (regra genérica ADR 0052 — qualquer locale → en-US → pt-BR). Não editar.

### 2. Adicionar nome nativo em `LOCALE_NAMES`

```ts
export const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português',
  'en-US': 'English',
  'es-419': 'Español',
  'de-DE': 'Deutsch', // ← nome do idioma na PRÓPRIA língua
}
```

Crítico: nome **nativo** (Deutsch, não Alemão). O `<LocaleSwitcher>` consome dinamicamente; zero edição de componente.

### 3. Criar diretório de mensagens

```bash
mkdir -p apps/web/src/messages/de-DE
# Espelhar todos os namespaces existentes em pt-BR
ls apps/web/src/messages/pt-BR | xargs -I {} touch apps/web/src/messages/de-DE/{}
```

Resultado esperado: `apps/web/src/messages/de-DE/` com mesmos arquivos `*.json` que `pt-BR/` (vazios).

### 4. Gerar tradução IA-assistida com Claude

```bash
pnpm i18n:translate --target de-DE
```

O script lê cada chave de `pt-BR/*.json`, manda pra Anthropic SDK com prompt especializado em tradução médica/fitness, escreve em `de-DE/*.json` mantendo a mesma estrutura. Usar `--namespace fisio` ou `--namespace common` para escopo restrito; sem flag traduz tudo.

Resultado esperado: arquivos `de-DE/*.json` populados com sugestões de tradução. **Não comitar ainda** — requer revisão humana (passo 5).

### 5. Revisão humana das traduções

- [ ] Revisor nativo passa por `apps/web/src/messages/de-DE/*.json` arquivo por arquivo
- [ ] Foco especial em: termos clínicos (anatomia, diagnósticos, exames), termos fitness (exercícios, equipamentos), termos comerciais (planos, cobrança), tom de voz (formal vs informal — alemão tem `Sie` vs `du`)
- [ ] Strings com `{variable}` precisam preservar nome literal da variável; reportar bugs de tradução IA que perderam variáveis
- [ ] Comitar revisão em PR separado pra rastreabilidade: `git commit -m "i18n: revisão humana de-DE — namespace fisio"`

### 6. Adicionar traduções de catálogos clínicos (tabela `translations`)

Para catálogos > 500 linhas (CID-10, CIF, TUSS, TACO, exercícios, suplementos, analitos — ADR 0052 §Decision parágrafo de catálogos), inserir traduções:

```bash
pnpm db:seed-translations --target de-DE --catalog cid10
pnpm db:seed-translations --target de-DE --catalog cif
pnpm db:seed-translations --target de-DE --catalog tuss
pnpm db:seed-translations --target de-DE --catalog taco
pnpm db:seed-translations --target de-DE --catalog exercises
pnpm db:seed-translations --target de-DE --catalog supplements
pnpm db:seed-translations --target de-DE --catalog analytes
```

Cada comando faz `INSERT INTO translations (entity_type, entity_id, locale, field, value) VALUES (...)` — **sem `ALTER TABLE`**, por design. Catálogos ≤ 500 linhas (tipos de plano, status, categorias) usam colunas `name_de` — adicionar coluna via migration trivial Drizzle.

### 7. Migration de `CHECK` constraint

```bash
# packages/db/migrations/NNNN-add-de-DE-locale.sql
ALTER TABLE persons DROP CONSTRAINT IF EXISTS persons_preferred_locale_check;
ALTER TABLE persons ADD CONSTRAINT persons_preferred_locale_check
  CHECK (preferred_locale = ANY(ARRAY['pt-BR','en-US','es-419','de-DE']));

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_default_locale_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_default_locale_check
  CHECK (default_locale = ANY(ARRAY['pt-BR','en-US','es-419','de-DE']));
```

Rebuild de constraint, não de tipo. Operação rápida (sem `ALTER TYPE`). Rodar via `pnpm db:migrate`.

### 8. Validação CI

```bash
pnpm i18n:check     # deve passar (zero chaves faltantes em de-DE)
pnpm typecheck      # deve passar (Locale type inclui 'de-DE')
pnpm test           # deve passar (testes não dependem de locale específico)
pnpm test:e2e -- --grep i18n-smoke   # smoke matrix em todos os locales (incluindo de-DE)
```

Resultado esperado: tudo verde. Smoke E2E carrega `/`, `/login`, `/signup` em `de-DE` e valida (a) sem chaves nuas tipo `common.foo.bar` na DOM, (b) sem overflow horizontal, (c) `<LocaleSwitcher>` lista "Deutsch".

### 9. Templates de email + PDF em de-DE

Para cada template existente em `apps/web/src/messages/{locale}/email-*.json` e `pdf-*.json` (ADR 0052 §Escopo de impacto), criar versão `de-DE`:

```bash
ls apps/web/src/messages/pt-BR/email-*.json pt-BR/pdf-*.json | \
  xargs -I {} cp {} {/pt-BR/de-DE}
pnpm i18n:translate --target de-DE --namespace email-welcome
pnpm i18n:translate --target de-DE --namespace email-recovery
# ... etc
# revisão humana → commit
```

### 10. Deploy

- [ ] Atualizar `<LocaleSwitcher>` no app — automático (consome `LOCALE_NAMES`, zero edit)
- [ ] CHANGELOG.md entrada `[Unreleased] - Added — Locale de-DE (deutsch) suportado`
- [ ] Roadmap atualizado se locale fizer parte de marco comercial
- [ ] Deploy normal via Vercel (sem flag — locale fica disponível pra todos os tenants)

## Rollback

Se algo der errado **antes do passo 7** (migration de CHECK): `git revert` no PR de adição de locale. Nada quebrou em produção — só dev/staging.

Se algo der errado **após passo 7** (migration aplicada em produção):

1. `ALTER TABLE persons DROP CONSTRAINT persons_preferred_locale_check; ALTER TABLE persons ADD CONSTRAINT persons_preferred_locale_check CHECK (preferred_locale = ANY(ARRAY['pt-BR','en-US','es-419']));` (remove `de-DE` da lista)
2. `UPDATE persons SET preferred_locale = 'pt-BR' WHERE preferred_locale = 'de-DE';` (transferir usuários que já trocaram para fallback)
3. `git revert` no commit que adicionou locale
4. Investigar root cause; voltar a tentar com fix

Tempo máximo aceitável de rollback: 30 minutos. Locale recém-adicionado tem N usuários ainda zero, então impacto é baixo.

## Monitoramento pós-execução

- [ ] Verificar `system_alerts` críticos nas próximas 24h
- [ ] Conferir métricas de adoção em PostHog (`event: locale_switched, properties.locale = 'de-DE'`)
- [ ] Conferir Sentry para erros associados ao novo locale (chaves não traduzidas escapando, formatação errada)
- [ ] Acompanhar feedback de tenants com cliente daquele idioma — primeira semana é janela crítica de detecção de tradução errada

## Em caso de falha

Contato emergência:
- **Fundador / DPO:** privacidade@logifit.com.br
- **Sentry:** alerta automático já dispara
- **Telegram:** canal privado (config local em `.env.runbooks`)

Falha de tradução errada **não** é incidente de segurança — não abrir `security_incidents`. Falha de migration que afeta tenants (RLS quebrado, dado inacessível) **é** incidente — abrir `security_incidents` (ADR 0067).

## Histórico

| Data | Quem | O quê | Resultado |
|---|---|---|---|
| 2026-04-25 | fundador | Esqueleto criado (Sprint 00 — sem locale novo aplicado) | n/a |
