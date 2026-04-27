# Sub-processadores LogiFit

> **Documento público.** Lista canônica de sub-processadores que tratam dados pessoais em nome da LogiFit, conforme **LGPD art. 6º + Resolução ANPD nº 18/2024 + Resolução ANPD nº 2/2024**.
>
> Espelho público de [`dpo.md`](dpo.md) — versão pública servida em `logifit.com.br/sub-processors`. Hash desta versão publicado em `logifit.com.br/sub-processors/hash` (SHA-256 do JSON canônico).

- **Versão:** 1.0
- **Última atualização:** 2026-04-27
- **Próxima revisão obrigatória:** 2026-10-27 (semestral)
- **Controlador:** LogiFit Tecnologia (CNPJ a registrar pré-1º tenant pagante)
- **Encarregado (DPO):** Everton Surkamp Pereira — `privacidade@logifit.com.br`

## Política de mudança

1. **Adição ou troca de sub-processador:** comunicação **30 dias antes** via banner no aplicativo + email aos `tenant_owner` de tenants pagantes.
2. **Tenant pode opor-se:** LogiFit avalia caso a caso (downgrade de feature ou rescisão amistosa sem multa).
3. **Hash desta lista** publicado em endpoint dedicado para detecção de mudança não-anunciada — clientes podem monitorar.
4. **Auditoria interna trimestral** valida que cada sub-processador tem DPA atualizado e jurisdição declarada bate com a lista.

## Sub-processadores ativos

| # | Provider | Categoria | Dado tratado | Jurisdição | Fase | DPA |
|---|---|---|---|---|---|---|
| 1 | **Vercel** | Hospedagem aplicação + edge | Logs HTTP, env vars cifradas, código | US (multi-region edge) | MVP + Fase 2 | [vercel.com/legal/dpa](https://vercel.com/legal/dpa) |
| 2 | **Supabase** | Banco PG + Auth + Storage + Realtime | Dados aplicação completos (cifrados at-rest) | SP — Brasil (sa-east-1) | MVP (até Sprint 19b) | [supabase.com/legal](https://supabase.com/legal) |
| 3 | **Oracle Cloud OCI** | Postgres self-hosted (ARM Ampere) | Dados aplicação completos (cifrados at-rest) | SP — Brasil | **Fase 2** (pós-Sprint 19b) | [oracle.com/legal/cloud](https://www.oracle.com/legal/cloud/) |
| 4 | **Cloudflare R2** | Object storage (mídia + backup off-site MVP) | Mídia clínica cifrada + dumps PG cifrados GPG | Multi-region (BR opt-in) | MVP + Fase 2 | [cloudflare.com/cloudflare-customer-dpa](https://www.cloudflare.com/cloudflare-customer-dpa) |
| 5 | **AWS S3** | Backup off-site Object Lock WORM | Dumps PG cifrados (camada extra além R2) | us-east-1 | **Fase 2** | [aws.amazon.com/compliance/gdpr-center](https://aws.amazon.com/compliance/gdpr-center/) |
| 6 | **Asaas** | Pagamentos (boleto/Pix/cartão) + cobrança recorrente | Dados financeiros + identificação tenant/member | BR (SP) | MVP + Fase 2 | [asaas.com](https://www.asaas.com/) |
| 7 | **Focus NFe** | Emissão fiscal unificada (NFS-e + NF-e + NFC-e + eventos) | Dados fiscais + cadastrais empresa/cliente | BR | MVP + Fase 2 | [focusnfe.com.br/termos-de-uso](https://focusnfe.com.br/termos-de-uso/) |
| 8 | **Resend** | Email transacional | Email destinatário + corpo (sem dado clínico) | US/EU (multi-region) | MVP + Fase 2 | [resend.com/legal/dpa](https://resend.com/legal/dpa) |
| 9 | **Sentry** | Error tracking + APM | Logs sanitizados (sem PII clínica via scrubber) | US (EU opt) | MVP + Fase 2 | [sentry.io/legal/dpa](https://sentry.io/legal/dpa/) |
| 10 | **PostHog** | Product analytics | Eventos pseudonimizados (não-PII) | US (EU opt) | MVP + Fase 2 | [posthog.com/dpa](https://posthog.com/dpa) |
| 11 | **Logtail / Axiom** | Logs estruturados | Logs aplicação + audit não-clínico | US/EU | MVP + Fase 2 | [betterstack.com](https://betterstack.com/) |
| 12 | **Upstash Redis** | Rate limit + cache (chaves transientes) | Chaves de rate limit por `(tenant_id, user_id, ip, endpoint)` | US/EU (Global) | MVP + Fase 2 | [upstash.com/dpa](https://upstash.com/dpa) |
| 13 | **Google Cloud Vertex AI** | LLM default (Gemini 2.5 Flash) + OCR + embeddings | Prompts + respostas IA + extração documentos | **SP — Brasil (southamerica-east1)** | MVP + Fase 2 | [cloud.google.com/terms/data-processing-addendum](https://cloud.google.com/terms/data-processing-addendum) |
| 14 | **Groq** | Speech-to-Text (Whisper) | Áudio transcrição (teleconsulta + diário voz) | US | MVP + Fase 2 | [groq.com](https://groq.com/) |

## Sub-processadores opcionais (BYOK)

Tenants podem trazer sua própria chave (Bring Your Own Key) para serviços de IA e pagamento. Nesse caso, o provider escolhido pelo tenant **não é** sub-processador da LogiFit — a relação contratual é direta entre tenant e provider:

- **Anthropic** (Claude — versões recentes Opus/Sonnet) — IA BYOK
- **OpenAI** (GPT) — IA BYOK
- **Maritaca AI** (Sabiá) — IA BYOK com data residency BR
- **Asaas com conta própria** — quando tenant Pro+ opera com conta Asaas dele

## Transferências internacionais de dados

LogiFit opera com **2 categorias** de transferência internacional, ambas amparadas por LGPD art. 33:

1. **Provedores em jurisdição com nível adequado** (UE, Reino Unido) — base art. 33-I.
2. **Provedores fora de jurisdição adequada** (US) com **cláusulas contratuais padrão (SCCs)** + DPA específico — base art. 33-II.

**Nenhum dado clínico (Nível 4 — ADR 0077) é processado fora da SA-East / Brasil.** Vertex AI fica obrigatoriamente em `southamerica-east1`. Sentry usa scrubber para remover PII clínica antes de envio. Logs estruturados sanitizam dados de saúde antes de export.

## Como reportar problemas com sub-processadores

- **Email:** `privacidade@logifit.com.br`
- **SLA de resposta:** 15 dias úteis (LGPD art. 18 + Resolução ANPD 2/2024)
- **Escalação ANPD:** [gov.br/anpd](https://www.gov.br/anpd) — direito do titular reclamar diretamente

## Histórico de mudanças

| Data | Mudança | Versão |
|---|---|---|
| 2026-04-27 | Documento público criado a partir de [`dpo.md`](dpo.md) | 1.0 |

## Referências

- [Lei 13.709/2018 — LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Resolução ANPD nº 18/2024](https://www.gov.br/anpd/pt-br) — Encarregado
- [Resolução ANPD nº 2/2024](https://www.gov.br/anpd/pt-br) — Direitos do titular
- [`dpo.md`](dpo.md) — versão interna canônica deste documento
- [ADR 0067 — DPO + Governança Compliance LGPD](../decisions/0067-dpo-governanca-compliance-lgpd.md)
