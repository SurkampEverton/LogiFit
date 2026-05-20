# ADR 0095 — Lib `qrcode` pra render QR TOTP (regra 46)

- **Status:** Accepted
- **Date:** 2026-05-20

## Context

Sprint 02b3 entregou wizard MFA TOTP `/cadastro/mfa-setup` com URI `otpauth://` em `<pre>` + secret manual formatado em grupos 4-4-4. Falta render visual de QR code — sem isso, paciente precisa copiar URI manualmente ou usar gerador QR externo, fricção significativa numa UX crítica de segurança.

Sprint 02b4 fechamento listou "QR code visual" como pendência com 2 opções:
- **(A)** Lib `qrcode` (~30KB, MIT, ~5M downloads/semana, zero deps runtime)
- **(B)** SVG Reed-Solomon próprio (~500l TS)

[Regra 46](../rules.md) exige ADR justificando toda dependência externa nova. Lib NPM open-source é dependência sujeita à regra mesmo não sendo SaaS — o espírito é "qualquer nova dependência exige defesa pública".

Reed-Solomon QR code é algoritmo padrão ISO/IEC 18004:2015 com encoding modes (numeric/alphanumeric/byte/kanji), error correction GF(256), 8 mask patterns + scoring, bitstream interleaving. Implementação madura de open-source levou anos de polimento; reimplementar do zero introduz risco operacional alto numa UX crítica (QR mal-formado quebra login do usuário).

## Decision

Adotar lib **`qrcode`** (`node-qrcode`) como dependência de `apps/web` pra render QR TOTP. Render **server-side** em Server Action retornando SVG string — wizard client injeta via `dangerouslySetInnerHTML`. Zero bundle JS no client.

### Por que (a) e não (b)

| Critério | Lib `qrcode` | SVG Reed-Solomon próprio |
|---|---|---|
| Tamanho código | dep externa | ~500l TS no repo |
| Bundle JS client | **zero** (render server) | zero (render server) |
| Risco de bug | baixo (lib madura, anos de polimento) | médio (algoritmo complexo, edge cases) |
| Manutenção LogiFit | watch security advisories | manutenção própria de Reed-Solomon GF(256) |
| Tempo de entrega | imediato | 1-2 dias de implementação + tests |
| Diferenciação competitiva | nenhuma (QR é padrão ISO) | nenhuma |

QR code não é diferenciador — é commodity técnica. Implementar do zero "pra evitar dep" gasta capital de implementação em problema resolvido.

### Justificativa regra 46

- **(a) Por que self-host não atende:** N/A — não há serviço SaaS de QR, é algoritmo local
- **(b) Lock-in concreto:** zero — `qrcode` é stateless, gera SVG/PNG sem rede; trocar por implementação própria é refactor de 1 função (`generateTotpQrSvg`)
- **(c) Custo mensal:** $0 (NPM package MIT, zero deps runtime)
- **(d) Plano de saída:** se `qrcode` parar de ser mantida (>1 ano sem release) OU CVE crítico sem fix em 30 dias, substituir por SVG Reed-Solomon próprio (opção b acima) — escopo isolado em 1 função

### Escopo de uso

Lib só pode ser importada via wrapper `apps/web/app/lib/qr-code.ts` exportando `generateTotpQrSvg(uri: string): string`. Outros usos (boletos, contratos, etc) exigem extensão deliberada do wrapper.

## Consequences

### Positivas

- UX MFA destravada — paciente escaneia QR sem precisar de gerador externo
- Render server-side preserva soberania visual (SVG vai no HTML inicial, funciona sem JS)
- Wrapper isolado facilita substituição futura
- Sem custo de manutenção de algoritmo Reed-Solomon próprio

### Negativas

- +1 dependência externa em `apps/web` (`qrcode` + `@types/qrcode` em dev)
- Bundle Next.js server cresce ~30KB (irrelevante — server-only)
- Watch list cresce: monitorar CVEs em `qrcode` via Dependabot

### Não-objetivos

- Não vamos usar `qrcode` pra render no client (preserva CSP rígido + zero JS)
- Não vamos expor APIs `qrcode` direto — sempre via wrapper `generateTotpQrSvg`
- Render PNG/JPEG não está no escopo (SVG cobre todos casos MVP)
