---
slug: hardware-catraca-android-default-mvp
status: accepted
date: 2026-05-13
---

# ADR 0018 — Hardware da catraca: Android box como default MVP, escolha cliente-final por catraca

## Contexto

Sprint 08 entrega controle de acesso (QR HMAC rotativo — ADR 0017). A última peça é o
hardware da catraca: dispositivo físico que lê QR + chama `POST /api/acesso/checkin`
+ envia heartbeat. Tenant configurará 1+ catracas por unit (entrada da academia,
sala fechada, etc.).

LogiFit não fabrica hardware — fornecemos especificação + firmware + UI de gestão
em `/app/acesso/catracas`. Cliente compra o dispositivo conforme orçamento e
infraestrutura existente.

### Opções consideradas

| Opção | Custo | Setup | Auth modes | Pros | Cons |
|---|---|---|---|---|---|
| **A. Android box** (Xiaomi Mi Box S, ~R$ 400) | $ | Fácil — app PWA em kiosk mode | qr, manual | Tela touch + câmera built-in + WiFi nativo + Android estável; troca QR leitor por câmera USB se precisar | Tela pequena pra catraca alta visibilidade |
| **B. iPad fixo + relé** (iPad usado ~R$ 1.500 + relé R$ 200) | $$$ | Médio — app PWA + Bluetooth relay | qr, manual | Tela grande + perf alto + bateria robusta | Custo alto; relé exige instalação elétrica catraca |
| **C. ESP32 + câmera OV2640** (~R$ 200) | $ | Difícil — firmware Arduino custom + lib OCR | qr | Mais barato; baixo consumo; standalone | Sem tela; UX feedback ruim; OCR QR no ESP32 é flaky |
| **D. Câmera IP + edge server** (~R$ 600 + ~R$ 800 mini-PC) | $$$$ | Complexa — mini-PC com Python rodando OpenCV | qr, facial | Suporta facial recognition (Sprint 09+); câmera IR cobre baixa luz; processa N catracas | Setup elétrico+rede complexo; mini-PC vulnerável |

## Decisão

Default MVP: **Android box** (opção A) por simplicidade de setup, custo baixo
e versatilidade. UI de cadastro de catraca expõe `hardware_type` como select
com 4 opções (Sprint 08 Faixa C — implementado em `new-catraca-form.tsx`).

Cliente escolhe na hora do cadastro. Schema permite **mix de hardware na mesma
unit** (ex: catraca principal Android, catraca interna ESP32 só QR).

### Pipeline Android box (default)

1. Cliente compra Android box (recomendamos Xiaomi Mi Box S 4ª gen ou similar)
2. Instala app PWA LogiFit em modo kiosk via Chrome
3. Cadastra catraca em `/app/acesso/catracas/new` (recebe `deviceToken` 1×)
4. Cola token no app — PWA salva em IndexedDB
5. PWA usa câmera frontal pra ler QR (lib `@zxing/library` no client)
6. PWA dispara `POST /api/acesso/checkin` com `x-device-token` header
7. Display verde/vermelho conforme `{allow}` da resposta
8. Heartbeat cada 30s em `POST /api/acesso/heartbeat`
9. NTP sync obrigatório (clock drift >120s causa falso negativo per ADR 0017)

Custo total catraca MVP: **~R$ 400-500** (Android box) + grade física tradicional.

### Pipeline alternativos (cliente opta)

- **iPad + relé**: pra clientes premium que já têm iPad sobrando. Mesmo PWA;
  diferença é Bluetooth relay pra abrir catraca tradicional eletromecânica.
- **ESP32**: pra cenários "low-tech high-volume" (academia grande com 6+
  catracas). Custo total muito baixo. Sprint 09+ pode fornecer firmware
  PlatformIO open-source.
- **Câmera IP + edge**: pra clientes Enterprise que querem **facial recognition**
  (modalidade `'facial'` em `access_devices.auth_modes`). Requer Sprint 09+
  pipeline pgvector + RIPD biometria assinado DPO (LGPD art. 11). Pré-requisito
  de hardware: câmera IP com IR (baixa luz) + mini-PC com GPU/NPU (NVIDIA
  Jetson Nano ou Coral Edge TPU) rodando MediaPipe/InsightFace.

### Auth modes por hardware

```
android-box   → ['qr', 'manual']           # default; câmera frontal pra QR + tela touch
ipad-relay    → ['qr', 'manual']           # mesmo que Android com hardware premium
esp32-camera  → ['qr']                     # standalone; sem manual (sem operador na frente)
ip-camera     → ['qr', 'facial', 'manual'] # único que suporta facial; Sprint 09+
```

Validado no campo de seleção do cadastro (`new-catraca-form.tsx`):
checkbox "facial" desabilitado se `hardware_type != 'ip-camera'`.

## Consequências

### Positivas

- **Custo MVP baixo**: Android box ~R$ 400 cobre 95% dos casos de academia
  pequena/média (até 500 members)
- **Setup pelo próprio cliente**: PWA + kiosk mode no Chrome instalável em <30min
  por catraca; LogiFit não fornece serviço de campo
- **Flexibilidade**: schema permite mix de hardware na mesma unit; cliente
  upgrade gradual pra iPad ou facial conforme orçamento
- **Open-source friendly**: Sprint 09+ pode publicar firmware ESP32 + scripts
  edge facial em repo separado pra comunidade contribuir
- **Independente de fornecedor**: zero lock-in de hardware proprietário (não
  precisamos comprar de fabricante específico)

### Negativas

- **Setup self-service exige cliente técnico**: PWA + kiosk mode + NTP sync
  não é trivial pra cliente leigo. Mitigação: tutorial em vídeo no
  `/app/settings/help/catraca-setup` (Sprint 09+).
- **Roubo do Android box**: dispositivo small-form-factor é furtável. Mitigação:
  catraca instalada dentro de balcão recepção + revoke remoto (Server Action
  `revokeDevice`).
- **PWA dependente de internet**: sem net = sem check-in. Mitigação: Sprint 09+
  adiciona offline queue (PWA arma checkins localmente, sincroniza ao voltar).
- **Facial recognition (modalidade `'facial'`) só com `ip-camera`**: limitação
  do MVP. Sprint 09+ pode adicionar suporte facial em Android (lib MLKit no
  client) se virar demanda.

## Migração futura

Sprint 09+ entrega:
- **Firmware ESP32 open-source** publicado em repo separado
- **Pipeline facial completo** (modalidade `'facial'`) com pgvector + RIPD
  biometria + consent LGPD art. 11 explícito
- **Offline queue** no PWA Android pra check-in resiliente
- **NTP sync automático** via campo de config no `/app/acesso/catracas/[id]`
- **Tutorial em vídeo** no help center

## Referências

- [Sprint 08 — Controle de acesso Academia](../sprints/08-academia-controle-acesso.md)
- [ADR 0017 — QR HMAC rotativo](0017-qr-hmac-rotativo-controle-acesso.md)
- [LGPD art. 11 — dado de saúde sensível](../rules.md#29)
- [Regra 31 — responsividade total mobile-first](../rules.md#31)
- `apps/web/app/app/acesso/catracas/new/new-catraca-form.tsx` — UI implementação MVP
