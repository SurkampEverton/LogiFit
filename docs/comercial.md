# LogiFit — Apresentação Comercial

> Material de venda/pitch baseado no planejamento técnico completo (sprints 00–30 + pós).
> Linguagem voltada para **gestor de clínica/academia**, **investidor** e **decisor de compra** — não para dev.
> Fonte técnica: [`modulos.md`](modulos.md) · [`roadmap.md`](roadmap.md) · [`arquitetura.md`](arquitetura.md).

---

## Em uma frase

A plataforma ERP que gerencia **academia, clínica de fisioterapia e consultório de nutrição** em um só lugar, com IA integrada, do estúdio individual à rede de franquias.

---

## Por que LogiFit?

1. **Uma plataforma, todas as especialidades** — cadastro único do cliente. Fisio, nutri e instrutor compartilham o histórico quando o paciente autoriza.
2. **Cresce com você** — de loja avulsa até rede franqueada sem trocar de sistema.
3. **IA que trabalha a seu favor** — previsão de cancelamento, copiloto, adaptação automática de treino.
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

- **Copiloto contextual** — "quais exames esse paciente tinha alterados?" responde em segundos
- **Previsão de cancelamento** — sistema identifica quem tem risco de cancelar nos próximos 30 dias, antes que aconteça
- **Intervenção sugerida** para recuperar o cliente em risco
- **Cross-alert lesão → treino** — fisio registra lesão, sistema adapta ficha da academia automaticamente (com consent)
- **Nutri-Agent** cruzando treino + prontuário + diário alimentar para sugerir ajuste
- **Cache semântico** de IA que reduz custo sem perder qualidade
- **Prescrição adaptativa por RPE** (roadmap) — ajuste automático de carga conforme percepção de esforço

### Segurança e conformidade regulatória

- LGPD 100%: criptografia, controle de acesso por nível, auditoria
- Dados sensíveis nunca vazam entre franquias (regra dura no banco, não opcional)
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
- **Passaporte entre franquias** — aluno treina em qualquer unidade quando habilitado

---

## Roadmap transparente

**MVP (primeiros 3–5 meses):** fundação técnica + Academia completa + motor cross-module. Entrega:

- Cadastro, agenda, financeiro, controle de acesso com QR/facial, copiloto, dashboard, funil de vendas, ofertas comerciais, fichas de treino com vídeos, avaliação física, WhatsApp, DRE, previsão de churn por IA, engajamento com conquistas.

**Fase 2 (+3–6 meses):** Fisioterapia completa.

- Prontuário COFFITO + ICP-Brasil, evolução SOAP, convênios TISS/TUSS, comissões, estoque, ANVISA + CNES, portal do paciente, cross-alert lesão→treino, Generative UI clínica.

**Fase 3 (+6–9 meses):** Nutrição completa + Mobile.

- TACO + plano alimentar + suplementos + exames + diário alimentar + teleconsulta + nutri-agent IA, app nativo, fiscal NFS-e nacional.

---

## Números de venda

| Métrica | Valor |
|---|---|
| Módulos funcionais | 100+ |
| Sprints planejados | 30 |
| ADRs arquiteturais | 38+ |
| Municípios brasileiros (NFS-e) | 5.500+ |
| Alimentos TACO | 3.000+ |
| Nutrientes por alimento | 30+ |
| Fórmulas antropométricas | 10+ |
| Integrações nativas | Asaas, WhatsApp, Resend, Supabase, Vercel, Focus NFe, Datasus CNES, ANS/TISS |
| Providers IA | Claude (padrão), OpenAI e Gemini (fallback) |
| Roles pré-configurados | 9+ (super_admin, diretor, gerente, recepção, fisio, nutri, instrutor, aluno, group_owner) |
| Cenários multi-empresa testados | 4 canônicos (rede própria, franquia clássica, franquia com passaporte, mix loja avulsa + rede) |

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
