# RIPD vX.Y — {{Módulo / Tratamento}}

> Relatório de Impacto à Proteção de Dados — exigido por LGPD art. 38 + Resolução ANPD nº 23/2024 para tratamento de larga escala de dados sensíveis (saúde, biométrico, genético).
> **Template baseado em ANPD Guia Orientativo de RIPD (2024).** Copie este arquivo para `docs/compliance/ripd/v1.0-{{slug}}.md`, preencha, peça parecer DPO, mude versão a cada mudança substancial.
> **Convenção de versionamento:** stubs pré-Sprint podem usar `v0.1` (rascunho explícito) OU `v1.0 (skeleton)` (versão-alvo com sufixo) — ambos aceitos enquanto `Parecer DPO: Pendente`. `v1.0` "limpo" (sem sufixo) só após o DPO aprovar a versão final pós-implementação **e** o hash SHA-256 estar populado pelo `scripts/hash-ripd.ts`. `v1.x+` = revisões substantivas pós-aprovação (semestral ou em mudança material).

- **Versão:** v1.0
- **Data de elaboração:** {{YYYY-MM-DD}}
- **Próxima revisão obrigatória:** {{YYYY-MM-DD}} (máximo 12 meses ou em mudança substancial)
- **Elaborado por:** {{nome — operador do produto/sprint}}
- **Parecer DPO:** {{aceito / aceito com restrições / rejeitado}} — assinado em {{YYYY-MM-DD}} por {{nome DPO}}
- **Hash SHA-256 do conteúdo:** {{sha256 — gerado por CI}}

## 1. Identificação do tratamento

- **Nome do módulo / feature:** {{ex: Pipeline de Exames Laboratoriais com IA}}
- **Sprint que entrega:** {{ex: Sprint 33}}
- **ADR de referência:** {{ex: ADR 0050}}
- **Finalidade declarada:** {{ex: Apoiar profissional na interpretação de exames laboratoriais via OCR + IA + revisão humana obrigatória}}
- **Categorias de dado tratado:**
  - [ ] Saúde (prontuário, exame, diagnóstico)
  - [ ] Biometria (face, digital, embedding)
  - [ ] Genética
  - [ ] Composição corporal / antropometria
  - [ ] Frequência de treino / dieta
  - [ ] Wearable (HR, VFC, sono)
  - [ ] Outros: {{...}}

## 2. Base legal (LGPD art. 7º + art. 11)

| Categoria | Base legal específica | Justificativa |
|---|---|---|
| {{categoria 1}} | art. 11, II, "{{a/d}}" — {{tutela da saúde / consentimento / etc}} | {{justificativa}} |

## 3. Princípios aplicados (LGPD art. 6º)

- **Finalidade:** {{como é específica e legítima}}
- **Adequação:** {{como dado coletado é adequado à finalidade}}
- **Necessidade:** {{como volume/categoria é mínimo necessário}}
- **Livre acesso:** {{titular pode consultar via /meu/privacidade}}
- **Qualidade:** {{como mantém atualidade}}
- **Transparência:** {{como informa sobre tratamento}}
- **Segurança:** {{controles técnicos — RLS, criptografia, audit, MFA}}
- **Prevenção:** {{como evita danos}}
- **Não discriminação:** {{como evita uso discriminatório, especialmente em IA}}
- **Responsabilização:** {{como demonstra cumprimento}}

## 4. Fluxo de dados

```
{{ASCII ou descrição: entrada → processamento → saída → retenção}}
```

- **Origem:** {{de onde vem — paciente, profissional, IoT, API externa}}
- **Quem acessa:** {{roles + scopes}}
- **Cross-border?** {{sim/não — se sim, qual provider, com DPA, transferência via Cláusulas Padrão ANPD}}
- **Retenção:** {{quanto tempo, base legal — 5a audit, 20a prontuário, etc}}
- **Anonimização/eliminação:** {{quando + como}}

## 5. Medidas de segurança (técnicas + organizacionais)

| Camada | Controle | Referência |
|---|---|---|
| Criptografia at-rest | AES-256-GCM por campo sensível + KEK por tenant | ADR 0073 camada 4 |
| Criptografia in-transit | TLS 1.3, HSTS preload | regra 35 |
| Isolamento | RLS multi-tenant + scope por company/unit | regras 1, 2, 25 |
| Auditoria | `audit_log` append-only + hash chain | regras 5, 39 |
| Autenticação | MFA obrigatório para profissionais + alto-risco | regra 43 |
| Autorização | RBAC + grants + consents | ADR 0005, ADR 0019 |
| IA específica | Comitê IA + classificador output + supervisão humana | regra 28, ADR 0053 |

## 6. Avaliação de risco

| Risco identificado | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| {{ex: vazamento de prontuário}} | baixa | alto | RLS + criptografia + hash chain + auditoria |
| {{ex: viés algorítmico em IA}} | média | médio | Supervisão humana obrigatória + classificador output + Comitê IA |

## 7. Direitos do titular implementados (LGPD art. 18)

- [ ] Confirmação do tratamento — `/meu/privacidade`
- [ ] Acesso — `/meu/dados/export`
- [ ] Correção — edição no portal
- [ ] Anonimização/bloqueio/eliminação — solicitação validada por DPO + retenção legal preservada
- [ ] Portabilidade — JSON + PDF legível
- [ ] Revogação de consent — toggle em portal
- [ ] Informação sobre compartilhamento
- [ ] Revisão de decisão automatizada (IA) — `/meu/alertas-ia`

SLA de atendimento: **15 dias** (LGPD).

## 8. Mudanças desde versão anterior

| Versão | Data | Mudança | Aprovado por |
|---|---|---|---|
| v1.0 | {{YYYY-MM-DD}} | Versão inicial | {{DPO}} |

## 9. Anexos

- Lista de sub-processadores específicos deste tratamento
- Diagrama do fluxo (link)
- Pareceres de auditoria interna (link)
