# ADR 0074 — Modo Coach mobile-first PWA + offline-first workout logging

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Personal trainer/educador físico no chão da academia tem um workflow operacional radicalmente diferente do gestor/recepção/fisio em consultório:

- **Mobile-only** — celular na mão andando entre alunos, raramente desktop
- **Offline-prone** — wifi de academia oscila, sets podem ser perdidos
- **Uma mão livre** — outra segura halter, anota, ajuda execução
- **Mãos suadas/sujas** — toques imprecisos, precisa de hit areas grandes
- **Multi-aluno simultâneo** — em estúdios pequenos, 3-4 alunos rotacionando
- **Timer crítico** — intervalo entre sets é parte da prescrição (60s/90s/3min)
- **Urgência** — "próximo aluno chegando, preciso fechar o set"

Estado atual do plano:

- **[ADR 0063](0063-responsividade-total-mobile-first.md)** decidiu `/app/*` responsivo, mas **não-PWA** — pensando em gestor desktop. Personal trainer ficou implícito sem solução
- **[ADR 0069](0069-perfil-paciente-hub-operacional.md)** criou `attendance_sessions` + Modo Atendimento — desenhado pra fisio em consultório com computador (sheet lateral SOAP)
- **Sprint 11** (treinos) entrega prescrição, mas a tela de **execução do treino pelo coach** ainda não foi planejada
- **Sprint 26** entrega PWA, mas só para `/meu/*` (paciente) — não cobre staff
- **Modo Solo (ADR 0069)** atende personal autônomo, mas no perfil do paciente desktop-style; não no chão da academia

**Gap real:** o personal trainer abre o celular, quer ver a planilha do aluno, marcar peso/reps/RPE de cada set, eventualmente registrar foto/vídeo de técnica, e seguir. Hoje isso vira um quebra-galho fora da plataforma (planilha física, app de notas, foto separada).

Pergunta do usuário (2026-04-24): "tenho o caso do instrutor olhar o treino do aluno durante o treino pelo celular, como poderiamos fazer?"

## Decision

### Parte 1 — `/app/coach/*` é PWA dedicado

`/app/*` permanece **responsivo mas não-PWA** (decisão ADR 0063 mantida para gestor/recepção). Mas adicionamos um **escopo PWA específico** para o coach:

```
/app/                              ← responsivo (gestor/recepção/fisio desktop)
  /coach/                          ← PWA INSTALÁVEL (mobile-first)
    /                              ← home: alunos do dia
    /sessao/[id]                   ← execução de treino single
    /multi                         ← supervisão multi-aluno (cards lado a lado)
    /aluno/[memberId]              ← drill rápido no member
/meu/                              ← PWA paciente (Sprint 26, separado)
```

**Manifest separado** em `/app/coach/manifest.webmanifest` com:

- `name`: "LogiFit Coach"
- `scope`: `/app/coach/`
- `start_url`: `/app/coach/`
- `display`: `standalone`
- `theme_color`: `#C77DFF` (roxo Treina)
- `icons`: 192x192 + 512x512 + maskable
- `shortcuts`: "Sessão de hoje", "Próximo aluno"

**Service Worker próprio** em `/app/coach/sw.js` com escopo `/app/coach/` — não conflita com SW de `/meu/` nem com `/app/*` (que não tem SW).

Coach tap "Instalar app" após **2ª visita** via `beforeinstallprompt` (mesmo padrão Sprint 26).

### Parte 2 — Reusa `attendance_sessions` (ADR 0069) com `kind` estendido

Não criamos novo schema. Estendemos o enum:

```sql
attendance_sessions
  kind enum ('consulta', 'treino', 'avaliacao_fisica', 'sessao_pilates')
  -- já existe: started_at, ended_at, expected_duration_min,
  --           draft_content jsonb, status
```

Para `kind='treino'`, `draft_content` schema:

```ts
{
  workout_id: string,            // FK pro plano de treino prescrito
  exercises: [
    {
      exercise_id: string,
      prescribed: { sets: 4, reps: '8-10', weight_kg: 18, rest_s: 90 },
      executed: [
        { set: 1, weight_kg: 18, reps: 10, rpe: 7, ts: '...', note?: string },
        { set: 2, weight_kg: 18, reps: 10, rpe: 8, ts: '...' },
        // ...
      ],
      media: [{ kind: 'photo'|'video'|'audio', url, ts }]  // reusa Sprint 21
    }
  ],
  rest_timer_started_at?: timestamp,  // pra timer entre sets
  notes_audio?: { url, duration_s, transcript? }
}
```

Ao `[Finalizar]`, dados migram pra tabelas oficiais:
- `workout_sessions` (Sprint 11) — registro consolidado
- `workout_logs` (Sprint 11) — sets executados (1 linha por set)
- `clinical_media` (Sprint 21) — fotos/vídeos/áudios anexados

### Parte 3 — Tela `/app/coach/sessao/[id]` (mobile-only by design)

Layout vertical, otimizado para 375-414px (iPhone SE até Pro Max). Desktop renderiza mas com aviso "esta tela foi desenhada para mobile, abra no celular".

```
┌─────────────────────────────┐
│ ← Bruno Silva · Push B      │  ← header compacto, 56px
│ ⏱ 23:14  · 4/6 exercícios   │
├─────────────────────────────┤
│                             │
│  EXERCÍCIO ATUAL            │
│  A1 · Supino inclinado      │
│  Plano: 4×8-10 @ 18 kg      │
│                             │
│  ─ Sets executados ─        │
│  ✓ Set 1: 18kg × 10 RPE 7   │
│  ✓ Set 2: 18kg × 10 RPE 8   │
│                             │
│  ━ SET 3 EM CURSO ━━━━━━━━  │  ← destaque visual forte
│  ⏱ Descanso: 47s            │  ← contador regressivo grande
│                             │
│  ┌───kg────┬──reps──┬─RPE─┐ │
│  │   ▼ 18 ▲│  ▼ 10 ▲│  8  │ │  ← steppers gigantes (44px)
│  └─────────┴────────┴─────┘ │
│                             │
│  [✓ Confirmar set]          │  ← botão 64px full-width
│                             │
│  ○ Set 4: planejado 18kg×10 │  ← próximo (placeholder leve)
│                             │
├─────────────────────────────┤
│ [📷] [🎤] [💬] [→ Próximo]  │  ← bottom nav 56px
└─────────────────────────────┘
```

**Decisões de UX:**

| Decisão | Motivo |
|---|---|
| **Foco em 1 exercício/1 set** | Coach precisa ver o que está fazendo agora, não os 12 exercícios de uma vez |
| **Steppers ▼▲ não keyboard** | Mãos suadas, teclado virtual atrapalha, stepper é tap-precise |
| **Hit areas ≥ 44px** | WCAG touch target + realidade da academia |
| **RPE picker 1-10 com cores** | Visual rápido (verde/amarelo/vermelho), não pensa em número |
| **Botão "Confirmar set" gigante** | É a ação mais frequente, precisa ser óbvia |
| **Timer regressivo após confirmar** | Coach foca no aluno, não no relógio; vibrate ao zerar |
| **One-thumb friendly** | Toda interação principal acessível com polegar direito |
| **Bottom nav fixo** | Padrão mobile (mãos do polegar) — câmera, áudio, mensagem, próximo |

### Parte 4 — Modo "supervisão multi-aluno"

Estúdio pequeno: personal pode ter 2-4 alunos rotacionando. Tela `/app/coach/multi`:

```
┌───────────────────────────────────────┐
│ ⏱ 14:32 · 3 alunos ativos · pausar todos │
├───────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │ Bruno   │ │ Marina  │ │ Ana     │   │
│ │ Push B  │ │ Funcional│ │ Push A  │   │
│ │ A1 · 3/4│ │ B2 · 2/3│ │ ⏸ pausa │   │  ← cards 1/3 cada
│ │ ✓ 18kg  │ │ ⏱ 32s   │ │         │   │
│ │ [tap]   │ │ [tap]   │ │ [tap]   │   │
│ └─────────┘ └─────────┘ └─────────┘   │
│                                       │
│ [+ Iniciar próximo aluno]             │
└───────────────────────────────────────┘
```

Tap no card → entra na tela do aluno acima. Volta com gesto de swipe (ou botão `←`). State persiste em IndexedDB — coach pode trocar de aluno sem perder progresso.

### Parte 5 — Service Worker offline-first com sync queue

```
ANTES da sessão (online):
  - SW pré-cacheia /app/coach/sessao/[id]
  - Inclui plano de treino completo + assets (vídeos demo de exercício)
  - Member info, last RPE, PRs

DURANTE a sessão (pode cair wifi):
  - Coach marca set → tenta POST /api/workout/log
  - Se online → grava direto + retorno no UI
  - Se offline → enqueue em IndexedDB { sets: [...], synced: false }
                → toast "1 set offline" no canto
                → UI mostra ✓ otimista (assume sucesso)

VOLTA online:
  - SW dispara sync background
  - Envia queue em ordem (idempotency_key por set)
  - Toast "✓ 8 sets sincronizados"
  - Se conflito (raríssimo) → marca como `needs_review`, coach vê banner

FINALIZAR sessão offline:
  - Permitido — dados ficam em IndexedDB
  - Próxima conexão sincroniza tudo + emite eventos `workout.completed`
```

**Idempotência**: cada set tem `client_id = uuid()` gerado offline. Server upsert por `client_id`. Reenvio não duplica.

### Parte 6 — Voz, foto, vídeo inline (reusa Sprint 21)

Bottom nav `[📷] [🎤] [💬]`:

- **📷 Foto** — abre câmera (getUserMedia), tira 1 foto, anexa ao exercise atual em `clinical_media`. Útil pra "veja como ela está executando o agachamento, ajustar joelho na semana que vem"
- **🎤 Áudio** — grava 5-30s de nota de voz. Background transcription via STT do ADR 0064 (Groq Whisper) → texto editável no fim da sessão
- **💬 Mensagem** — abre sheet pra mandar mensagem rápida pro aluno (WhatsApp via Sprint 13 ou chat in-app)
- **🎥 Vídeo curto** — 5-10s (Web MediaRecorder), análise de execução; comprimido client-side antes do upload (Web Codecs API ou ffmpeg.wasm Sprint 21)

Storage: reusa `clinical_media` schema com `kind='workout_form_check'`. Quota por plano (Solo 1GB / Starter 5GB / Pro 50GB do ADR 0066).

### Parte 7 — Push pra "próximo aluno"

Service Worker recebe push notification quando:

- **Aluno chegou pra sessão** — gym detector via QR/catraca/check-in manual recepção
- **Aluno cancelou em cima da hora** — agenda Sprint 03 atualiza
- **Set demora > 2× o esperado** — coach esqueceu? lembrete sutil

Push payload:

```json
{
  "type": "next_student_arrived",
  "memberId": "...",
  "memberName": "Marina Costa",
  "minutesEarly": 12,
  "currentSession": "bruno_silva_push_b",
  "actionUrl": "/app/coach/sessao/marina_costa_funcional"
}
```

Notificação tem 2 ações: `[Iniciar agora]` (navega) e `[Em 5 min]` (snooze).

### Parte 8 — Web Bluetooth para integração de sensores (Android only)

Chrome Android suporta Web Bluetooth API. Coach pode parear:

- **Bioimpedância BLE** (Tanita BC-401, Renpho ES-CS20M) — leitura direta antes do treino
- **Cardiofrequencímetro BLE** (Polar H10, Garmin HRM-Pro) — RPE objetivo via FC zona
- **Smart cable / encoder de velocidade** (Vitruve, GymAware) — VBT (velocity-based training)

iOS Safari **não suporta** Web Bluetooth → fallback manual entry. Cobertura completa só com app nativo Expo na Fase 3 (Sprint 31+).

### Parte 9 — Onboarding contextual

Quando coach acessa `/app/coach/*` pela primeira vez:

1. Detecta se é mobile (UA + viewport) → mostra tour onboarding
2. Detecta se é desktop → mostra QR code "abra no celular pra melhor experiência" + permite continuar mesmo assim
3. Após 2ª visita → exibe `beforeinstallprompt` "Adicionar à tela inicial"
4. Após instalar → push prompt "Receber alertas de aluno chegando?"

## Consequences

### Positivas

- **Cobre caso real de 700k+ profissionais** — personal trainer/educador físico mobile-only no Brasil é mercado massivo desatendido
- **Reusa schema `attendance_sessions`** (ADR 0069) — não cria fragmentação; mesma lógica de timer/finalização
- **Service Worker pattern compartilhado** com Sprint 26 (portal paciente) — mesmo conhecimento, mesmas libs, menor manutenção
- **Modo Solo ganha cara mobile real** — personal autônomo (ADR 0069) tem ferramenta de uso real no chão da academia
- **Offline-first resolve dor de wifi** — academia normalmente tem wifi ruim; sets executados não somem
- **Web Bluetooth Android** abre porta pra VBT/cardio direto sem app nativo
- **Push pro "próximo aluno"** diferencia de planilha de Excel + WhatsApp manual
- **Câmera/áudio inline** evita coach abrir 4 apps diferentes (planilha, WhatsApp, câmera, notas)
- **Multi-aluno** atende estúdio (alta rentabilidade), não só personal 1:1
- **Performance** — bundle menor que `/app/*` (só telas necessárias), Service Worker pré-cacheia, oferecemos snappy mesmo em iPhone SE 2020

### Negativas (mitigáveis)

- **2 PWAs no mesmo subdomínio** (`/meu/*` paciente + `/app/coach/*` staff) precisa scope cuidadoso — `manifest scope` explícito + SW path resolution; testar em Chrome devtools "Manifest"
- **Service Worker complexity** adiciona ~300 LOC + testes E2E offline-online; mitigado por entrega incremental (cache estático primeiro, sync queue depois)
- **Voz/foto consomem storage** — quota por plano controla; auto-delete de mídia após 90d (com opt-in pra preservar)
- **iOS Safari PWA limitations** persistem (BLE, push reliability) — fallback manual + roadmap pra Expo Sprint 31
- **Sync queue conflitos** se coach offline por horas — idempotência via `client_id` resolve 99%; <1% vão pra `needs_review` manual
- **Coach instala wrong PWA** (instala `/meu/` em vez de `/app/coach/`) — install prompt contextual + manifest com `start_url` explícito + ícones diferentes (azul vs roxo)
- **Bundle size** do PWA coach precisa ser pequeno (<200KB JS gzipped) — code splitting agressivo + lazy load Web Bluetooth/Audio APIs

### Riscos não endereçados

- **Background sync iOS Safari instável** (até iOS 17.4) — sets podem demorar a sincronizar quando volta online; toast "X sets pendentes" mostra status; manual "Sincronizar agora" sempre disponível
- **Coach esquece de finalizar sessão** — ficha em `status='active'` indefinidamente; job nightly detecta sessão >12h ativa e auto-finaliza com flag `auto_closed=true`
- **Performance em dispositivos antigos** (Android Go 2GB RAM) — testar em Lighthouse mobile budget; aceitar trade-off de não suportar BLE em low-end
- **LGPD com fotos/vídeos do aluno** — consent específico no contrato (já coberto ADR 0054); paciente pode revogar via portal `/meu/privacidade` (ADR 0067)
- **Modo solo + multi-aluno** — autônomo pode ter 4 alunos no estúdio dele; precisa testar quando uma pessoa = `mode='solo'` mas usa multi-aluno simultaneamente
- **Conflito de UI em tablet** — iPad em modo retrato é grey area (responsivo? mobile? PWA?); decisão: tablet usa `/app/coach/*` mas com layout adaptado wider (cards de aluno 2-col)

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| App nativo Expo desde MVP | Caro manter app store + revisão Apple/Google; PWA cobre 95% Android Chrome; iOS Sprint 31 cobre o restante |
| Tornar `/app/*` inteiro PWA | Bloat para gestores desktop (manifest único confuso); user pode instalar admin no celular sem querer; conflito de scope |
| Mobile responsivo simples (sem PWA) | Sem offline = perde sets ao cair wifi (deal-breaker); sem install = atrito; sem push = perde notificação de aluno |
| Compartilhar PWA com `/meu/` (paciente) | Confusão de role + scope; conflito de permission; UI/UX completamente diferentes |
| Coach edita planilha via WhatsApp/Notion | Não-integrado, sem timer, sem RPE estruturado, sem sync com prescrição, sem audit |
| Tela coach apenas dentro de `/app/treinos/sessao/[id]` (sem PWA) | Igual à anterior — perde offline + push + install; coach não vai usar |
| Modo coach = 1 aluno por vez (sem multi) | Estúdio com 3 alunos rotacionando é caso comum; perder esse mercado |
| Steppers só por keyboard input | Teclado virtual cobre tela e exige precisão fina; mãos suadas erram |
| Web Bluetooth obrigatório | iOS não suporta; criar dependência mata o uso |
| Push iOS via FCM web push | Funciona mas é flaky (Safari 16.4+); aceitar como fallback |

## Escopo de impacto

**Sprints novos / ajustados:**

- **Sprint 00** — `<CoachLayout>` componente derivado de `<PortalLayout>` (Sprint 00); manifest base + Service Worker template; tokens touch já estão prontos
- **Sprint 11 (treinos)** — implementa `/app/coach/sessao/[id]` + execução de set + sync queue + `attendance_sessions kind='treino'` + tabelas `workout_sessions` + `workout_logs`; é o sprint principal deste ADR
- **Sprint 12 (avaliações físicas)** — adapta tela de coach pra registrar avaliação no celular (perimetria, 1RM teste, salto, etc) com mesmo padrão
- **Sprint 13 (engajamento)** — push channel "next_student_arrived" + "set_overdue" + "session_complete"
- **Sprint 21 (mídias clínicas fisio)** — extensão de `clinical_media` pra cobrir `kind='workout_form_check'`; ffmpeg.wasm + compress client-side
- **Sprint 26 (portal paciente PWA)** — compartilha base de Service Worker / manifest pattern; refatora pra `<SharedPWAShell>` reusável
- **Sprint 31 (futuro · app nativo Expo)** — cobre BLE iOS, HealthKit, push iOS reliable; PWA Coach permanece como fallback web

**Schemas:**

```sql
-- Adiciona enum value (sem novo schema)
ALTER TYPE attendance_kind ADD VALUE 'treino';
ALTER TYPE attendance_kind ADD VALUE 'avaliacao_fisica';
ALTER TYPE attendance_kind ADD VALUE 'sessao_pilates';

-- Schema novo no Sprint 11 (sessões consolidadas)
workout_sessions
  id uuid pk
  tenant_id uuid
  member_id uuid fk
  workout_id uuid fk
  coach_user_id uuid fk
  attendance_session_id uuid fk  -- liga ao draft
  started_at timestamptz
  ended_at timestamptz
  duration_min int
  total_volume_kg numeric  -- soma de peso × reps
  avg_rpe numeric
  notes text
  status enum ('completed','partial','cancelled')

workout_logs  -- 1 linha por set executado
  id uuid pk
  tenant_id uuid
  session_id uuid fk
  exercise_id uuid fk
  set_index int
  weight_kg numeric
  reps int
  rpe numeric
  rest_actual_s int nullable
  is_pr bool default false
  client_id uuid unique  -- idempotência offline
  logged_at timestamptz

-- Push subscriptions específicas do coach PWA
coach_push_subscriptions
  user_id uuid pk
  endpoint text
  keys_p256dh text
  keys_auth text
  device_name text  -- "Pixel 7 Pro"
  installed_at timestamptz
```

**Docs:**

- `docs/modulos.md` — adicionar módulo "Modo Coach mobile-first PWA" na seção `geral` (Sprint 11)
- `docs/comercial.md` — destacar coach mode como diferencial vs Tecnofit/Trainerize
- `docs/sprints/11-geral-prescricoes-e-biblioteca.md` — adicionar entrega da tela coach + offline-first
- `docs/rules.md` — eventualmente regra "ações mobile-críticas precisam PWA install + offline" (não obrigatório no MVP)
- `CLAUDE.md` — citar este ADR como base do mobile workflow staff
- `CHANGELOG.md` — entrada deste ADR

**Telas a prototipar (alta prioridade):**

- `prototipo/telas/coach-treino-mobile.html` — viewport 375×812 simulando iPhone SE
- `prototipo/telas/coach-multi-mobile.html` — supervisão multi-aluno
- `prototipo/telas/coach-install-prompt.html` — instalação PWA + onboarding

## Related

- Estende [ADR 0063 — Responsividade total mobile-first](0063-responsividade-total-mobile-first.md) — adiciona caso PWA staff (não previsto antes)
- Estende [ADR 0069 — Perfil paciente como hub operacional](0069-perfil-paciente-hub-operacional.md) — reusa `attendance_sessions` com novo `kind='treino'`
- Estende [ADR 0071 — Sistema de tratamento de erros + alertas tempo real](0071-sistema-tratamento-erros-alertas-tempo-real.md) — push channel coach
- Depende de [ADR 0064 — Arquitetura IA](0064-ia-arquitetura-gemini-default-byok-rag.md) — STT Whisper para transcrever notas de voz
- Depende de [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — quotas de storage/IA por plano
- Depende de [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — consent de mídia clínica
- Prepara fundamentos para Sprint 31 (futuro app nativo Expo) — PWA continua como fallback web

## Referências

- [Web App Manifest scope spec](https://developer.mozilla.org/en-US/docs/Web/Manifest/scope) — múltiplos PWAs no mesmo origin
- [Background Sync API](https://developers.google.com/web/updates/2015/12/background-sync) — Chrome 49+, Safari não suporta (fallback manual)
- [Web Bluetooth API status](https://caniuse.com/web-bluetooth) — Chrome Android sim, iOS Safari não
- Benchmarks: Trainerize (Canadá, US$ 8/cliente/mês), TrueCoach (US$ 12), Tecnofit Personal (R$ 79/mês) — todos têm app nativo, nenhum tem coach mode robusto offline-first
- Inspiração UX: Hevy (gym tracker app · execução de set), MyFitnessPal (steppers grandes), Strong (timer entre sets)
