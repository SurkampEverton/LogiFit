# LogiFit — Apresentação Comercial

> Material de venda/pitch baseado no planejamento técnico completo (sprints 00–36 + roadmap fase 3 até 40).
> Linguagem voltada para **gestor de clínica/academia**, **investidor** e **decisor de compra** — não para dev.
> Fonte técnica: [`modulos.md`](modulos.md) · [`roadmap.md`](roadmap.md) · [`arquitetura.md`](arquitetura.md).

---

## Em uma frase

A plataforma ERP que gerencia **academia, clínica de fisioterapia e consultório de nutrição** em um só lugar, com IA integrada, do estúdio individual à rede de franquias.

---

## Por que LogiFit?

1. **Uma plataforma, todas as especialidades** — cadastro único do cliente. Fisio, nutri e instrutor compartilham o histórico quando o paciente autoriza.
2. **Cresce com você** — de loja avulsa até rede franqueada sem trocar de sistema.
3. **IA que trabalha a seu favor** — assistente universal que conversa e executa ações com confirmação, previsão de cancelamento, copiloto clínico, adaptação automática de treino.
4. **Segurança hospitalar** — LGPD, criptografia, auditoria, assinatura digital ICP-Brasil.
5. **Feito para o Brasil** — Asaas, TISS/TUSS, NFS-e em todos os municípios, WhatsApp, PIX.

---

## O que seu cliente ganha

### Conquistando novos alunos / pacientes

- Funil de vendas completo: lead → aula experimental → proposta → matrícula
- Código de indicação com benefício para quem traz amigo (referral)
- Propostas versionadas com validade
- Captação via WhatsApp com mensagem automática
- Rastreamento de origem (Instagram, indicação, walk-in, panfleto)

### Cobrando sem dor de cabeça

- Cobrança recorrente automática via PIX, boleto ou cartão (sem consumir limite)
- Régua de cobrança automática: mensagem D+1, D+3 e D+7 via WhatsApp e e-mail
- Bloqueio automático da catraca em caso de inadimplência (volta ao pagar)
- Faturamento de convênios TISS/TUSS (Unimed, Bradesco, Amil, SUS, etc.)
- Controle de glosas com recurso
- Planos e pacotes combinados (mensalidade + 8 aulas de pilates + 2 consultas nutri)
- Cupons de desconto e promoções sazonais
- Cashback para retenção
- **Emissão automática de NFS-e** em todos os municípios brasileiros (cobertura nacional via Focus NFe) — pacote de notas incluso no plano + cobrança proporcional ao volume real de emissão

### Controlando a operação diária

- Agenda única por profissional, sala e equipamento
- Lista de espera automática
- Confirmação 24h antes que reduz falta (lembrete WhatsApp)
- Controle de sessões do pacote contratado
- Estoque de descartáveis e produtos de revenda com alerta de mínimo
- PDV simples para venda no balcão
- Comissão automática para profissional autônomo, com transferência em 1 clique
- DRE completo com lucratividade por procedimento
- Previsão de receita 3 meses à frente
- Trancamento automático de matrícula (ex: 30 dias sem check-in)

### Atendendo com excelência técnica

**Academia:**

- Fichas de treino digitais com vídeos curtos
- Biblioteca de exercícios categorizada
- Registro de execução com percepção de esforço (RPE)
- Modalidades próprias (musculação, coletiva, personal)
- Controle de acesso por QR dinâmico (rotaciona a cada 60s) ou reconhecimento facial

**Fisioterapia:**

- Prontuário eletrônico com assinatura digital ICP-Brasil (validade jurídica)
- CID-11 e CIF completos para classificação COFFITO
- Evolução SOAP rápida por sessão
- Anexo de exames (raio-X, ressonância, vídeos de execução, fotos posturais)
- Templates por especialidade (ortopedia, neuro, respiratória, pediatria, uroginecologia)
- Cronograma ANVISA de manutenção/calibração de equipamentos
- Integração CNES

**Nutrição:**

- Banco TACO com ~3.000 alimentos e 30+ nutrientes
- Plano alimentar drag-and-drop com cálculo em tempo real (kcal, macros, micros)
- Lista de substituição automática (1 pão francês = 2 fatias de forma)
- Prescrição de suplementos com alerta de interação medicamentosa
- Exames laboratoriais com destaque de alteração
- Gráficos de evolução por analito

**Todas as verticais:**

- Avaliações físicas (Pollock, Petroski, Guedes, Durnin, Mifflin-St Jeor, Cunningham)
- Gráficos comparativos de evolução
- Anamnese estruturada
- Upload de mídia em storage criptografado

### Engajando quem importa

- Portal do paciente (web PWA) — agenda, pagamento, recibos, vídeos de exercícios domiciliares, QR de acesso, teleconsulta
- Diário alimentar com foto — paciente registra, nutri valida
- Conquistas ("50 check-ins", "3 meses de assiduidade") — gamificação que retém
- Brindes físicos ou créditos por metas atingidas
- Metas com progresso automático (peso, frequência, PR)
- Lembretes automáticos de água, refeição, manutenção, agenda
- Teleconsulta com vídeo e gravação opt-in (respeitando sigilo médico)

### IA como diferencial de mercado

- **Assistente IA universal** — chat acessível em qualquer tela do sistema, no celular ou no desktop, falando a linguagem de cada usuário (aluno, recepção, profissional, gestor, contador). Pergunta "quando é minha próxima aula?" ou "cancela minha aula amanhã" — o assistente responde **e executa** com confirmação
  - **3 níveis de capacidade** com segurança progressiva:
    1. **Tirar dúvida sobre o sistema** ("como faço X?") — respondida do manual integrado, instantâneo, sem custo
    2. **Consultar dados** ("qual minha mensalidade?", "quantos alunos hoje?") — respeita permissão de cada usuário
    3. **Executar ação** ("cancela essa aula", "gera 2ª via", "cadastra esse lead") — sempre com **tela de confirmação** antes de fazer; nada acontece sem você ver o que vai acontecer
  - **Diferencial competitivo único no Brasil:** Tecnofit, Trainerize, iClinic, Feegow, ActiveWise — nenhum oferece IA que **executa ações** com camada de confirmação. Ainda estão na geração "sugere/copia-e-cola"
- **Copiloto clínico contextual** — "quais exames esse paciente tinha alterados?" responde com fontes citadas em segundos
- **Previsão de cancelamento** — sistema identifica quem tem risco de cancelar nos próximos 30 dias, antes que aconteça, e sugere intervenção
- **Cross-alert lesão → treino** — fisio registra lesão, sistema adapta ficha da academia automaticamente (com consent)
- **Nutri-Agent** cruzando treino + prontuário + diário alimentar para sugerir ajuste
- **Cache semântico** de IA que reduz custo sem perder qualidade
- **Prescrição adaptativa por RPE** (roadmap) — ajuste automático de carga conforme percepção de esforço

#### Como funciona o Assistente IA universal

| Para o **aluno/paciente** | Para a **recepção/admin** | Para o **profissional** |
|---|---|---|
| "Quando é minha próxima aula?" | "Cadastra um lead chamado João" | "Resume a evolução do paciente X" |
| "Cancela aula de amanhã" | "Quantos cancelamentos hoje?" | "Sugere CID pra dor lombar crônica" |
| "Gera 2ª via do boleto" | "Gera 2ª via para o João Silva" | "Cria rascunho da próxima sessão" |
| "Como funciona o Pilates?" | "Inadimplentes do mês" | "Próximo paciente está aqui?" |

**Cota incluída no plano** (hard-stop sem cobrança surpresa):

| Plano | Chamadas IA/mês | BYOK (sua chave própria) |
|---|---|---|
| Solo R$ 49 / Solo Combo R$ 69 | 200 | — |
| Starter R$ 99 | 500 | — |
| Pro R$ 199 | 3.000 | opcional |
| Business R$ 449 | 10.000 | ✅ opcional |
| Enterprise | 25.000 default | ✅ ilimitado quando ativo |

Cache semântico reduz consumo em até 60% (perguntas comuns reaproveitam resposta). Limite mensal excedido = **bloqueio até o próximo ciclo** + convite a configurar sua própria chave de IA (BYOK). **Não cobramos overage de IA** — sem surpresa em fatura. Termo "chamada" = 1 invocação ao modelo que **não** seja cache hit.

### Emissão fiscal — pacote incluso + custo proporcional

Todo plano com emissão fiscal traz um **pacote de notas inclusas no preço-base** + **cobrança proporcional** se você emitir mais. Modelo justo: tenant pequeno paga só o plano; tenant que emite muito paga proporcional ao volume.

| Plano | Notas inclusas/mês | Custo por nota extra | Tipos cobertos no contador* |
|---|---|---|---|
| Solo R$ 49 | 20 | R$ 0,50 | NFS-e (serviço) |
| Solo Combo R$ 69 | 30 | R$ 0,50 | NFS-e (serviço) |
| Starter R$ 99 | 50 | R$ 0,50 | NFS-e (serviço) |
| Pro R$ 199 | 200 | R$ 0,40 | NFS-e + NF-e + NFC-e + devolução + transferência + conserto |
| Business R$ 449 | 1.000 | R$ 0,35 | Todos os tipos + intercompany |
| Enterprise | 5.000 default | R$ 0,25 (negociável) | Todos |

*\* **Eventos não contam** no contador de overage (cancelamento de nota, CC-e/Carta de Correção, inutilização) — ficam livres para você corrigir e operar sem peso na fatura. Repasse calibrado sobre custo do provider de emissão fiscal (Focus NFe) + margem operacional para sustentar a plataforma.*

**Exemplo prático:** academia Business com 2.000 alunos emitindo 2.000 mensalidades/mês:
- Plano: R$ 449
- 1.000 notas inclusas → 0 overage para essas
- 1.000 notas extras × R$ 0,35 = R$ 350 overage
- **Total fatura: R$ 799/mês** (vs R$ 449 plano + cobrança fiscal externa pelo contador, que sairia mais cara e dolorosa)

**Por que esse modelo é melhor que concorrentes:**

| Concorrente | Cobrança fiscal |
|---|---|
| **Tecnofit, ActiveWise** | Não emite NFS-e — você precisa contratar parte fiscal externa (mais caro, mais retrabalho) |
| **iClinic, Feegow** | Emissão à parte cobrada por nota desde a 1ª (sem pacote incluso) |
| **LogiFit** | Pacote incluso no plano + repasse direto sem markup escondido |

**UI mostra preview da fatura** sempre — você vê em tempo real quantas notas emitiu, quantas faltam do pacote, e qual será o total da próxima fatura.

**Segurança built-in:**

- Aluno só vê e age sobre os **próprios dados** — IA respeita permissão automaticamente
- **Conformidade CFM 2.454/2026 em duas camadas obrigatórias** para feature SaMD II+ (ex: pipeline de exames, Nutri-Agent): (1) **Comitê de IA cadastrado no tenant** + ata de criação — gate institucional; (2) **classificador anti-prescrição** que bloqueia "diagnóstico de", "prescrever", "tem [doença]" — gate técnico em toda chamada. Sem comitê = feature não ativa
- IA nunca diagnostica, sempre sugere com supervisão humana documentada (`ai_audit_log` registra input, output, modelo, decisão humana)
- **PII mascarada** antes de sair pro provider de IA (CPF/RG/email/telefone)
- **Audit completo** de toda interação — quem perguntou, o que pediu, qual ação foi confirmada, por quem
- **Ações destrutivas bloqueadas** no MVP (excluir, anonimizar, cobrar em massa) — exigem fluxo manual dedicado

### Segurança e conformidade regulatória

- LGPD 100%: criptografia, controle de acesso por nível, auditoria
- Dado clínico nunca cruza company quando o tenant é franquia (regra dura no banco, não opcional — RLS + regra 25)
- Multi-empresa: dono vê consolidado sem ver dado individual de outra empresa
- Consent granular: paciente aprova exatamente o que quer compartilhar
- Audit log completo: quem leu prontuário, quando e por quê
- Guarda indeterminada conforme CFN/CFM/COFFITO
- Assinatura ICP-Brasil no prontuário
- ANVISA: cronograma de manutenção e calibração, logs de limpeza
- CNES integrado
- NFS-e para qualquer município brasileiro (cobertura nacional via Focus NFe)

### Controlando o negócio

- Dashboards por perfil:
  - **Recepção:** check-ins ao vivo, agenda do dia, ausências
  - **Gerente:** KPIs da filial (MRR, ocupação, ticket médio, inadimplência)
  - **Diretor:** tenant consolidado
  - **Dono do grupo:** visão agregada de todos os tenants
- Cards principais: Alunos Ativos, Faturamento 30d, Taxa de Retenção 90d, Horário de Pico, Ocupação por Modalidade, Ticket Médio por Aluno
- Comparativo mês × mês, ano × ano
- Top performers do mês (opt-in)
- Export PDF e CSV com branding da clínica

### Pronto para crescer

- **Loja avulsa** — sistema esconde termos técnicos, aparece simples
- **Matriz + filiais** com CNPJ próprio — 1 tenant, N empresas
- **Franquia** — franqueado isolado, franqueador vê apenas agregados
- **Grupo holding** — vários negócios do mesmo dono, dashboard consolidado
- **Crescimento orgânico** — de avulsa para rede é configuração, não migração dolorosa
- **Passaporte de franquia** — aluno treina em qualquer unidade da rede (mesmo tenant) quando habilitado pelo franqueador

---

## Roadmap transparente

**MVP (primeiros 3–5 meses):** fundação técnica + Academia completa + motor cross-module. Entrega:

- Cadastro, agenda, financeiro, controle de acesso com QR/facial, copiloto, dashboard, funil de vendas, ofertas comerciais, fichas de treino com vídeos, avaliação física, WhatsApp, DRE, previsão de churn por IA, engajamento com conquistas.

**Fase 2 (+3–6 meses):** Fisioterapia completa.

- Prontuário COFFITO + ICP-Brasil, evolução SOAP, convênios TISS/TUSS, comissões, estoque, ANVISA + CNES, portal do paciente, cross-alert lesão→treino, Generative UI clínica.

**Fase 3 (+6–9 meses):** Nutrição completa + Mobile + Fiscal completo.

- TACO + plano alimentar + suplementos + exames + diário alimentar + teleconsulta + nutri-agent IA, app nativo, **emissão fiscal completa** (NFS-e + NF-e produto + NFC-e varejo + devolução + transferência + conserto + eventos) com cobertura nacional via Focus NFe; otimização gradual de custo via NFS-e Padrão Nacional pós-PMF.

---

## Planos e preços

| Plano | Preço | Para quem é | O que inclui |
|---|---|---|---|
| **Solo** | **R$ 49/mês** | Profissional autônomo (CREF/CREFITO/CRN/CRP/CRO/Pilates/esteticista) atendendo 1-1 | UX simplificada · 30 pacientes ativos · agenda · prontuário · receita/recibo · cobrança PIX · IA 200 chamadas · WhatsApp · MEI/RPA fiscal simplificado |
| **Solo Combo** | **R$ 69/mês** | Profissional Solo que combina 2-3 áreas (ex: nutricionista + personal trainer) | Tudo do Solo + 60 pacientes · até 3 verticais simultâneas · IA 200 chamadas · templates por profissão |
| **Starter** | **R$ 99/mês** | Pequeno negócio com equipe ≤5 profs especializado **em uma área** | **Academia no MVP** (Fisio/Nutri liberam quando módulos saem nas Fases 2/3) · 100 alunos/pacientes · 5 profissionais · 50 NFS-e/mês · IA 500 chamadas · Portal do paciente · WhatsApp · Asaas |
| **Pro** | **R$ 199/mês** | Clínica ou academia que atende **mais de uma especialidade** ao mesmo tempo | Todas as 3 verticais simultâneas · 500 alunos/pacientes · 10 profissionais · 200 notas/mês · IA 3.000 chamadas · Convênios TISS/TUSS 4.01 · Device Hub · Pipeline Exames · BYOK opcional |
| **Business** | **R$ 449/mês** | Rede pequena (5-10 unidades) ou holding com múltiplos CNPJs | Tudo do Pro + multi-company · até 3 CNPJs · 2.000 alunos/pacientes · 30 profissionais · 1.000 notas/mês · IA 10.000 · Adquirência · Rateio · Generative UI clínica |
| **Enterprise** | **sob consulta** | Rede grande, hospital, clínica com DPO próprio | Tudo do Business + ilimitado · BYOK ilimitado · SLA 99,9% · White-label · Gestor de conta · **DPO-as-a-service add-on opcional via firma especializada** |

**Trial:** 14 dias com features Pro · sem cartão de crédito · dados **retidos 30 dias** após expiração e então **anonimizados** (preserva agregados, remove identificação pessoal — LGPD-friendly).

**Desconto anual:** 2 meses grátis (~14%) — Starter R$ 89/mês · Pro R$ 179/mês · Business R$ 399/mês. (Solo e Solo Combo já entram com pricing de entrada e não acumulam desconto anual.)

**Cobrança por paciente único por contrato:** se você opera vários contratos LogiFit (ex: 2 clínicas = 2 tenants), cada paciente conta como 1 active member em cada contrato em que está vinculado. **O passaporte cross-tenant entre clínicas não duplica** o paciente dentro do mesmo contrato — ele é 1 active member por (paciente, tenant).

### DPO interno × DPO-as-a-service

- **Todo plano vem com DPO interno LogiFit** (canal `privacidade@logifit.com.br`, plano de resposta 72h, sub-processors públicos, RIPD por módulo) — cumpre integralmente as obrigações da LGPD para tenants pequenos e médios.
- **DPO-as-a-service** é **add-on opcional do plano Enterprise** — LogiFit revende o serviço de uma **firma especializada externa** (não somos nós que assumimos a responsabilidade legal de DPO terceirizado para sua organização). Indicado para tenants enterprise com >500 titulares ou exigência regulatória própria.

### Por que Starter "à escolha de vertical"

Negócio pequeno geralmente faz **uma coisa só** — academia de bairro, consultório fisio solo, nutricionista solo. Não faz sentido pagar por features das outras 2 verticais que ele nunca vai usar.

**Você escolhe na hora do cadastro:**

```
[x] Vou usar para Academia (alunos, treinos, ficha, catraca, mensalidade)  ← disponível MVP
[ ] Vou usar para Fisioterapia (prontuário, evolução SOAP, convênios)      ← Fase 2
[ ] Vou usar para Nutrição (TACO, plano alimentar, diário do paciente)    ← Fase 3
```

Tudo pronto pra área escolhida, sem ruído das outras. Quando seu negócio crescer e quiser combinar verticais (clínica integrada de saúde), você passa pra Pro com 1 clique. **No MVP a única vertical disponível no Starter é Academia**; clientes que escolheriam Fisio/Nutri entram em lista de espera com desconto de fundador para quando o módulo lançar.

### Hospedagem: Supabase no MVP, infra própria pós-validação

Durante o MVP, infra é Vercel + Supabase Pro. **Pós-Sprint 19b** (após MVP estável por 30d), migramos para Postgres self-hosted no Oracle Cloud OCI free tier + Cloudflare R2 — reduz custo recorrente em ~70% e reduz lock-in. Migração foi planejada desde o dia 1 com 8 regras de portabilidade que valeram durante todo MVP. Cliente final não percebe (zero downtime no cutover; janela noturna).

### Comparativo direto com concorrentes

| Concorrente | Preço entrada | LogiFit Starter R$ 99 oferece a mais |
|---|---|---|
| **Tecnofit Lite** | R$ 99 | Multi-vertical à escolha · IA assistente · NFS-e incluída · Portal do paciente PWA |
| **Tecnofit Pro** | R$ 199 | -R$ 100 + IA + NFS-e (Tecnofit não emite nota) |
| **iClinic Pro** | R$ 119 | -R$ 20 + IA assistente + WhatsApp régua + Portal aluno |
| **NutMed** | R$ 99 | Mesmo preço + IA + Portal + integração WhatsApp |
| **Dietpro** | R$ 89 | +R$ 10, mas com IA, WhatsApp, fiscal automatizado |
| **ActiveWise** | R$ 149-299 | -R$ 50 a -R$ 200 + IA |
| **Feegow** | R$ 199-599 | -R$ 100 a -R$ 500 + multi-vertical no plano de entrada |

---

## Números de venda

| Métrica | Valor |
|---|---|
| Módulos funcionais | 100+ |
| Sprints planejados | 40+ |
| ADRs arquiteturais | 44+ |
| Municípios brasileiros (NFS-e) | 5.500+ |
| Alimentos TACO | 3.000+ |
| Nutrientes por alimento | 30+ |
| Fórmulas antropométricas | 10+ |
| Integrações nativas | Asaas, WhatsApp, Resend, Supabase, Vercel, Focus NFe, Datasus CNES, ANS/TISS |
| Providers IA | Gemini Flash (padrão LogiFit, datacenter SP), OpenAI e Anthropic (fallback automático), Groq Whisper (transcrição), Maritaca (BR opcional); BYOK em qualquer plano |
| Roles pré-configurados | 14+ (super_admin, tenant_owner, dpo, diretor, gerente, recepcao, medico, fisio, nutri, personal, enfermeiro, instrutor, member, group_owner) |
| Cenários multi-empresa testados | 5 canônicos (rede própria, franquia clássica, franquia com passaporte de franquia, mix loja avulsa + rede no mesmo group, modo solo autônomo) |

---

## Público-alvo de venda

| Perfil | Dor que LogiFit resolve |
|---|---|
| **Dono de academia pequena/média** | Sistema único em vez de 5 planilhas; integração com catraca; cobrança automática; retém aluno com IA |
| **Rede de academias** | Consolidado financeiro real; isolamento entre filiais; mobilidade do aluno opcional |
| **Franqueadora** | Dashboard agregado sem acessar dado individual (regulatório); split de comissão; padrão na marca |
| **Clínica de fisioterapia** | Prontuário válido juridicamente; TISS/TUSS funcionando; ANVISA e CNES em ordem; comissão automática |
| **Nutricionista autônomo** | TACO + plano alimentar em 5 minutos; diário do paciente com foto; teleconsulta LGPD |
| **Holding com múltiplos negócios** | 1 sistema, N CNPJs, dashboard consolidado do dono, operação separada por marca |

---

## Frase de fechamento

**LogiFit não é um sistema de gestão que virou ERP de saúde. É um ERP de saúde pensado do zero para o Brasil.**
