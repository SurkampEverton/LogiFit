# Template — Notificação de Incidente à ANPD

> Template oficial LogiFit para notificação à Autoridade Nacional de Proteção de Dados (ANPD) em até **72h** após confirmação de incidente de segurança envolvendo dados pessoais (LGPD art. 48 + Resolução ANPD nº 15/2024).

**Quem submete:** DPO LogiFit ([`docs/compliance/dpo.md`](dpo.md)).
**Quando:** dentro de 72h após confirmação do incidente — não da detecção (LGPD art. 48 §3º).
**Onde:** portal ANPD em [https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento) (formulário online; fallback email `comunicacao@anpd.gov.br`).
**Backup:** anexar PDF assinado a `security_incidents.notification_payload` (ADR 0067) para trilha interna + WORM S3 anchor (regra 39).

---

## Cabeçalho da comunicação

| Campo | Valor |
|---|---|
| **Controlador** | LogiFit Tecnologia Ltda. — CNPJ {a preencher} |
| **DPO responsável** | {nome} — `privacidade@logifit.com.br` — {telefone} |
| **Operadores envolvidos** | {Supabase / Vercel / Asaas / etc — apenas os tocados pelo incidente} |
| **Tenants impactados** | {N tenants — listar slugs em anexo cifrado se >10} |
| **Data de confirmação do incidente** | YYYY-MM-DD HH:MM TZ |
| **Data de detecção** | YYYY-MM-DD HH:MM TZ (pode ser anterior) |
| **Data desta notificação** | YYYY-MM-DD HH:MM TZ |
| **ID interno** | `security_incidents.id` (UUID) |

---

## 1. Natureza do incidente (LGPD art. 48 §1º I)

> Descrição factual do que ocorreu, em linguagem acessível. Sem jargão técnico desnecessário.

- **Tipo:** {acesso não autorizado · vazamento · exfiltração · indisponibilidade prolongada · alteração indevida · destruição · perda · outro}
- **Vetor:** {credencial comprometida · vulnerabilidade explorada · erro de configuração · ação de insider · ataque externo · falha em sub-processador · outro}
- **Cronologia resumida:** {3-5 linhas: quando começou, quando foi detectado, quando foi contido}
- **Status atual:** {contido · em contenção · em investigação}

---

## 2. Categorias e número de titulares afetados (art. 48 §1º II)

| Categoria de titular | Número confirmado | Número estimado (faixa) | Observação |
|---|---|---|---|
| Pacientes (pessoa natural) | N | {min}-{max} | {ex: apenas tenants academia / fisio / nutri} |
| Profissionais de saúde | N | {min}-{max} | {CRM/CREFITO/CRN/CREF se aplicável} |
| Operadores administrativos | N | {min}-{max} | |
| Menores de idade | N | {min}-{max} | LGPD art. 14 — agravante; especificar |
| Outros | N | {min}-{max} | {especificar} |

**Total estimado:** {N} titulares.

---

## 3. Categorias e quantidade de dados afetados (art. 48 §1º II)

> Listar **somente as categorias atingidas pelo incidente confirmado**. Se sensibilidade incerta, classificar conservadoramente como sensível.

- [ ] Identificação básica (nome, CPF, RG, email, telefone, endereço)
- [ ] Dados financeiros (cartão, PIX, conta bancária, histórico de pagamento)
- [ ] **Dados sensíveis LGPD art. 5º II / art. 11** — saúde física, saúde mental, prontuário, exames, prescrições, biometria (facial / TOTP / WebAuthn)
- [ ] Dados de menor de idade (LGPD art. 14)
- [ ] Credenciais de autenticação (hashes, tokens, secrets)
- [ ] Logs de comportamento (acesso, geolocalização, dispositivo)
- [ ] Comunicações privadas (WhatsApp, email, anotações livres)
- [ ] Outros: {especificar}

**Volume de registros:** {N linhas / arquivos / mensagens}.
**Escopo temporal:** dados de {YYYY-MM-DD} a {YYYY-MM-DD}.

---

## 4. Medidas técnicas e administrativas adotadas (art. 48 §1º IV)

### 4.1 Contenção (já executada)

- [ ] Sessões revogadas (`UPDATE auth.sessions SET revoked_at = now()`)
- [ ] Tokens API rotacionados (Asaas, Focus NFe, Resend, Supabase service role)
- [ ] Chave de credencial comprometida invalidada + rotacionada
- [ ] Acesso de IP/range bloqueado em Cloudflare WAF
- [ ] Feature flag desativada (se aplicável)
- [ ] Sub-processador notificado e isolado (se aplicável)
- [ ] Backup íntegro confirmado e isolado (regra 40)
- [ ] Outros: {especificar}

### 4.2 Investigação (em andamento ou concluída)

- [ ] Logs preservados em S3 WORM Object Lock (regra 39)
- [ ] `audit_log` hash chain verificada — sem quebra / **com quebra em** {timestamp}
- [ ] Forense interna: {nome do responsável + escopo}
- [ ] Forense externa contratada: {sim / não — empresa, data}
- [ ] Boletim de ocorrência registrado: {sim / não — número, delegacia}

### 4.3 Mitigação (planejada com prazo)

| Ação | Responsável | Prazo | Status |
|---|---|---|---|
| {ex: revisão de IAM e least privilege em todos sub-processadores} | Tech Lead | D+30 | planejado |
| {ex: implantação de detecção anomalia em queries volumétricas} | Sec Eng | D+60 | planejado |
| {ex: pen test direcionado ao vetor explorado} | Empresa externa | D+90 | planejado |

---

## 5. Riscos e impactos para os titulares (art. 48 §1º III)

> Avaliação honesta. Não minimizar.

- **Probabilidade de uso indevido:** {baixa · média · alta}
- **Severidade do dano potencial:** {baixa · média · alta · crítica}
- **Tipos de dano possíveis:**
  - [ ] Discriminação (saúde, gênero, etnia)
  - [ ] Fraude financeira
  - [ ] Roubo de identidade
  - [ ] Constrangimento / dano à reputação
  - [ ] Exposição de condição de saúde (LGPD art. 11)
  - [ ] Dano físico (ex: stalking facilitado por geolocalização)
  - [ ] Outros: {especificar}
- **Justificativa para notificar / não notificar titulares:**
  - **Notificou titulares:** {sim — método, data} / {não — justificativa baseada em art. 48 §2º: "risco ou dano relevante"}

---

## 6. Comunicação aos titulares (se aplicável)

- **Método:** {email transacional · banner in-app · SMS · WhatsApp · carta registrada}
- **Data de envio:** YYYY-MM-DD
- **Conteúdo enviado:** anexar template (recomendado: 6 elementos — natureza do incidente; dados afetados; medidas tomadas; recomendações ao titular; canal de contato; direitos LGPD art. 18)
- **Taxa de entrega confirmada:** {N de M titulares}

---

## 7. Anexos obrigatórios

1. Relatório técnico interno (PDF assinado por DPO + Tech Lead)
2. Linha do tempo detalhada (CSV ou Markdown)
3. Lista de tenants e titulares impactados (cifrada — chave separada por canal seguro à ANPD)
4. Cópia da comunicação aos titulares (se enviada)
5. Cópia do BO (se registrado)
6. Print/log do `audit_log` no momento da quebra (se aplicável — regra 39)

---

## 8. Compromissos pós-incidente

- [ ] Atualização do RIPD do(s) módulo(s) afetado(s) ([`docs/compliance/ripd/`](ripd/))
- [ ] Atualização do threat model do(s) módulo(s) ([`docs/threat-models/`](../threat-models/))
- [ ] Atualização ou criação de runbook ([`docs/runbooks/`](../runbooks/))
- [ ] Comunicação interna à equipe (post-mortem em até D+15)
- [ ] Auditoria interna trimestral ajustada (ADR 0067)
- [ ] Re-treinamento de equipe se vetor humano

---

## 9. Assinaturas

| Papel | Nome | Data | Assinatura |
|---|---|---|---|
| DPO | {nome} | YYYY-MM-DD | {ICP-Brasil ou rubrica} |
| Tech Lead | {nome} | YYYY-MM-DD | |
| Representante legal | {nome} | YYYY-MM-DD | |

---

## Histórico

| Versão | Data | Autor | Mudanças |
|---|---|---|---|
| 1.0 | 2026-04-25 | DPO LogiFit | Versão inicial — atende LGPD art. 48 + Resolução ANPD nº 15/2024 + 6ª auditoria documental |

## Referências

- [LGPD Lei 13.709/2018 art. 48](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Resolução ANPD nº 15/2024](https://www.gov.br/anpd/pt-br/assuntos/noticias) — comunicação de incidente
- [`docs/compliance/dpo.md`](dpo.md) — papel e contato do DPO
- [`docs/runbooks/incidente-lgpd-72h.md`](../runbooks/incidente-lgpd-72h.md) — runbook que invoca este template
- [`docs/runbooks/exfiltracao-detectada.md`](../runbooks/exfiltracao-detectada.md) — runbook complementar (vetor exfiltração)
- [ADR 0067](../decisions/0067-dpo-governanca-compliance-lgpd.md) — DPO + governança compliance
- [ADR 0073 regra 39](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) — hash chain audit + WORM S3
