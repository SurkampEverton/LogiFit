# ADR 0050 — Pipeline de extração e interpretação de exames laboratoriais

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O Sprint 30 (Nutri · Suplementos + Exames) planejou `lab_analytes` + `lab_reference_ranges` + `lab_results` + upload de PDF — mas com **digitação manual**. Um hemograma completo tem ~30 analitos; perfil lipídico + metabólico + hormonal juntos podem ter >50. Digitação manual é:

1. Lenta (~15-30 min por exame)
2. Propensa a erro (vírgula vs ponto, unidade errada)
3. Desmotivadora para nutri/fisio — acaba não registrando
4. Perde insights longitudinais se só 20% dos exames entram no sistema

Paciente frequentemente traz laudo em PDF (hoje quase todo laboratório entrega digital). Profissional gostaria de:

- Subir PDF → ver valores extraídos em segundos
- IA sugerir padrões (perfil aterogênico, padrão de anemia, sinais de resistência à insulina)
- Validar antes de virar histórico oficial
- Paciente poder subir próprio exame pelo portal para agilizar consulta

## Decision

Criar **Sprint 33 — Pipeline Inteligente de Exames Laboratoriais** como módulo Geral cross-vertical, entre Device Hub (Sprint 32) e Nutri-Agent (renumerado para Sprint 34).

### Arquitetura

```
Upload (Portal ou operador) → exam_documents (PDF/imagem em Storage criptografado)
                                       ↓
                            OCR via provider abstrato (reusa ADR 0035 — OCR.space default)
                                       ↓
                              exam_extractions (texto bruto + metadata)
                                       ↓
                     IA de extração estruturada (Claude via AI SDK — Sprint 06)
                     ├─ Identifica tipo de exame (hemograma, lipídico, hormonal, etc)
                     ├─ Mapeia analitos para lab_analytes (LOINC ou nome + fuzzy)
                     ├─ Extrai value + unit + measured_at + laboratory
                     └─ Retorna JSON validado por Zod
                                       ↓
                      IA de interpretação preliminar (Claude)
                      ├─ Compara valores com lab_reference_ranges (sexo/idade)
                      ├─ Sugere padrões cross-analito (perfil aterogênico, padrão anêmico)
                      ├─ NUNCA diagnostica — apenas sugere hipótese
                      └─ Gera exam_interpretations_draft (associada ao exam)
                                       ↓
               exam_reviews (status=pending_review) aguarda profissional
                                       ↓
        Profissional em /app/members/[id]/exames/pending/[id]
        ├─ Vê laudo + extração + interpretação lado a lado
        ├─ Valida/corrige valores (pode editar cada analito)
        ├─ Concorda/edita/descarta interpretações da IA
        ├─ Adiciona observações próprias
        └─ Clica "Confirmar e adicionar ao histórico"
                                       ↓
        Publicação oficial em lab_results (uma linha por analito)
        + exam_interpretations_final (validada pelo profissional)
        + evento lab_result.published → dispara alertas (régua Sprint 13)
```

### Regras duras

1. **IA nunca diagnostica** — prompts fixos com guardrails (reforça ADR 0015). Vocabulário permitido: "sugere", "compatível com", "pode indicar", "considerar avaliação". Vocabulário proibido: "diagnóstico de", "tem", "apresenta [doença]". Classificador de output valida antes de salvar.

2. **Todo exame passa por revisão profissional** antes de virar `lab_results` oficial — mesma filosofia do Device Hub (ADR 0049). IA assiste, humano decide.

3. **Revisão é audit-logada** — quem revisou, quando, quais edições fez. Regra 5.

4. **Paciente pode subir** pelo portal com `consent.self_upload_exam`. Upload fica em `exam_reviews.status=pending_review` até profissional revisar. Paciente recebe notificação "exame recebido, em análise" + "exame validado e adicionado ao histórico" (régua Sprint 13).

5. **Regra 25 preservada** — exame clínico em `topology=franchise` não atravessa `company_id` nem com consent.

6. **LGPD reforçada**:
   - Upload e storage sempre criptografados at-rest
   - Envio para IA externa (Claude) exige contrato LGPD (Anthropic Enterprise ou similar)
   - Opt-out: tenant pode desabilitar IA para laudos sensíveis (só OCR + revisão humana)
   - Dados sensíveis particulares (resultado HIV, psiquiátricos, genéticos) ficam em categoria com permission específica `exam.sensitive.read`

### Escopo vs. Sprint 17 (anexos clínicos)

- **Sprint 33 (este):** exame **laboratorial** — PDF com valores numéricos de analitos (hemograma, bioquímica, hormonal, urina, etc.). Entra no pipeline para virar `lab_results` estruturado.
- **Sprint 17 (Fisio evolução):** anexo clínico de mídia — raio-X, ressonância, tomografia, ultrassom, **foto postural**, vídeo de execução. Não tem analitos extraíveis; fica em `evolucao_attachments` como anexo qualitativo sem parsing.

Ambos podem coexistir em uma consulta — raio-X no Sprint 17, laudo de bioquímica no Sprint 33.

### Integração com módulos existentes

- **Sprint 30 Nutri Exames** — `lab_analytes` + `lab_reference_ranges` + `lab_results` são **reusados**. Sprint 33 apenas **alimenta** `lab_results` automaticamente via pipeline + revisão; digitação manual continua disponível como fallback.
- **Sprint 06 Copilot** — infra de Vercel AI SDK + cache semântico + rate-limit. Pipeline de exame usa essa infra + adiciona prompts especializados.
- **Sprint 35 OCR (era 15)** — reusa provider abstrato OCR configurado pelo admin.
- **Sprint 26 Portal paciente** — adiciona `/meu/exames/upload` para self-upload.
- **Sprint 34 Nutri-Agent (antes 33)** — consome `lab_results` publicados + pode pedir exames específicos quando detectar gaps (ex: "considerar pedir perfil lipídico pela ausência nos últimos 12 meses").

## Consequences

### Positivas

- **Economia massiva de tempo**: 30 min de digitação → 2 min de revisão
- **Padronização cross-lab**: mesmo analito de Sabin, DB, Hermes Pardini entra normalizado
- **Histórico longitudinal completo**: 5+ anos em gráficos automáticos (Sprint 30 já tem)
- **Alertas proativos automáticos**: glicemia + HbA1c altas → alerta risco diabético
- **Paciente engajado**: portal permite subir laudo imediatamente, agiliza próxima consulta
- **Nutri-Agent (Fase 3) enriquecido**: cruza exames completos + diário + antropometria

### Negativas (mitigadas)

- **Custo de IA** — cada exame chama Claude 1-2 vezes; cache semântico (Sprint 06) reduz; estimativa: R$ 0,10-0,30 por exame processado
- **LGPD sensível** — dado de saúde vai para Anthropic; contrato Enterprise mandatório; opt-out do tenant possível
- **Erro de OCR em laudos exóticos** — fallback manual (editar campos ou reverter para digitação) sempre disponível
- **Risco de confiar na IA** — UI destaca claramente "Valores extraídos pela IA - REVISE antes de confirmar" + nunca confirma automático
- **Laudos muito velhos (impressos à máquina)** — OCR falha; aceita, mas sugere digitação manual como caminho

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Apenas digitação manual (Sprint 30 como está) | Perde 80% do valor — exame digitado manual é exceção, não regra |
| Extração sem interpretação IA | Perde cross-analito pattern matching (perfil aterogênico, padrão anêmico) que é o valor agregado |
| IA interpreta e publica direto | Risco clínico inaceitável; responsabilidade profissional perdida; LGPD + CFM/COFFITO/CFN violados |
| Incluir dentro do Sprint 30 (expandir) | Sprint 30 fica com 4-5 semanas; escopo cross-vertical (Fisio usa também) justifica sprint próprio |
| Colocar em Fase 4 (pós-MVP + Fisio + Nutri) | Valor muito alto para deixar para depois; Nutri-Agent (34) se beneficia muito |

## Escopo de impacto

- **Sprint 33 (NOVO)** — Pipeline Inteligente de Exames Laboratoriais
- **Sprint 34 Nutri-Agent** (renumerado de 33) — consome lab_results automatizados
- **Sprint 35 App Nativo** (renumerado de 34) — upload de exame via app nativo também
- **Sprint 36 Fiscal** (renumerado de 35)
- **Pós-35** Prescrição adaptativa por RPE
- **Sprint 30 Nutri Exames** — mantém schema (reusa pipeline) + nota no arquivo
- **Sprint 26 Portal** — `/meu/exames/upload` ativado
- **docs/modulos.md, docs/roadmap.md, CHANGELOG.md** — atualizados

## Related

- Reusa [ADR 0035 — OCR provider abstrato](0035-sem-implementar-ocr-ainda-mas-definido.md)
- Reforça [ADR 0015 — Copilot consulta/sugestão, nunca prescrição]
- Espelha padrão de curadoria do [ADR 0049 — Device Hub](0049-device-hub-wearables-clinicos.md)
- Preserva regras 4 (criptografia), 5 (audit), 6 (consent cross-module), 25 (dado clínico cross-company franchise)
