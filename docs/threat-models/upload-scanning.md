# Threat Model STRIDE — Upload scanning (`scanUpload` MIME real + magic bytes + ClamAV)

> **Stub** — Threat model esperado para o pipeline de scan de uploads (regra 38 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 4). MVP: file-type lib + magic bytes + embed proibido + tabela `upload_scans`. Fase 2: ClamAV no scan worker. Será expandido. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** `scanUpload(file)` em `packages/security/scan-upload.ts` — todo upload de Supabase Storage (MVP) / Cloudflare R2 (Fase 2) passa por validação de MIME real + magic bytes + bloqueio de embed (PDF JS, Office macro) + ClamAV (Fase 2); só vira `published` após status `clean`; lint `no-unscanned-upload` em CI
- **Sprint:** 00 (pipeline base + lint) + 21 (mídia clínica fisio) + 33 (PDF de exames) + 17 (NF-e XML/PDF importadas)
- **Data:** stub criado em 2026-04-26
- **ADR de referência:** [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 4)

## Superfície de ataque (a expandir)

```
[Cliente] (web ou mobile)
        │
        │ 1. POST /api/upload (multipart) com File
        ▼
[Server Action wrapApiHandler]
        │
        │ 2. valida tamanho + extensão declarada + tenant scope
        ▼
[Storage put (status=pending)]
        │
        │ 3. salva em bucket privado com prefix /pending/{tenant_id}/{uuid}.bin
        ▼
[Worker async scanUpload(uploadId)]
        │
        ├── 3.1. file-type lib lê magic bytes → confirma MIME real
        ├── 3.2. compara declarado vs real → reject se diverge
        ├── 3.3. bloqueia embed: PDF com /OpenAction /JavaScript, Office com macro VBA, SVG com <script>, ZIP com path traversal
        ├── 3.4. (Fase 2) ClamAV daemon scan via socket → status virus|clean
        ▼
[upload_scans tabela]
        │
        ├── status=clean → move para /published/ + notifica owner
        ├── status=infected|invalid → move para /quarantine/ + grava security_incident + notifica DPO
        ▼
[UI mostra "processando" → "publicado" / "rejeitado: motivo"]
```

**Trust boundaries críticos:**
1. Cliente → Server Action (auth + permission `upload.create.{module}`)
2. Server Action → Storage bucket (credenciais com escopo tenant via signed URL)
3. Worker scanner → ClamAV daemon (socket Unix isolado em container)
4. Worker → DB `upload_scans` (RLS por tenant)

## Análise STRIDE (a expandir conforme features de upload entram)

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | Atacante envia arquivo `payload.exe` renomeado para `evolucao-paciente.pdf` — file-type lib detecta MIME real (executável) ≠ extensão (PDF) → reject |
| **T**ampering | Polyglot file (PDF + ZIP + EXE no mesmo arquivo) explora parsers diferentes — magic bytes só pega o primeiro tipo; mitigação: validador específico por feature (PDF para exames roda PDF normalize que descarta payload escondido) |
| **R**epudiation | Profissional envia evolução com mídia, depois nega — `upload_scans` registra `uploaded_by_user_id` + hash + timestamp + IP; hash entra em `audit_log` ligado à evolução assinada (regra 39) |
| **I**nformation disclosure | Bucket pendente exposto via signed URL com TTL longo demais — TTL ≤5min para upload + ≤24h para download de arquivo published; signed URLs sempre por tenant scope |
| **D**enial of service | **Vetor crítico** — atacante envia 1000 arquivos de 100MB em sequência para encher quota de storage do tenant + custo de scanning. Mitigação: rate limit (regra 36) por `(tenant_id, endpoint=upload)` 10/min + quota total de upload por plano + tamanho máximo por arquivo (50MB default) |
| **E**levation of privilege | Embed JS em PDF é executado por viewer browser do recepcionista que abre o arquivo → XSS contextual. Mitigação: scanUpload bloqueia `/OpenAction` + `/JavaScript` na fase de scan; viewer renderiza PDF em iframe sandbox; CSP bloqueia inline script |

## Áreas críticas que o threat model expandido precisa cobrir

- **Polyglot files** (PDF/ZIP/EXE combinados) — investigar lib de detecção; PDF normalize via `qpdf --linearize --flatten-annotations` antes de aceitar como published
- **Office macros** (DOCX/XLSX com VBA) — bloquear até Fase 2; quando ativar, exigir conversão para PDF antes
- **SVG com script** — usar lib `dompurify` server-side para sanitizar SVG antes de aceitar
- **Imagens com EXIF malicioso** — strip metadata antes de publicar (também bom para LGPD: GPS, modelo de câmera podem identificar)
- **Compressão recursiva (zip bomb)** — limite de profundidade + tamanho descomprimido antes de aceitar ZIP
- **MIME chunked / Content-Type não confiável** — sempre derivar MIME do conteúdo, ignorar header HTTP
- **Quarentena** — bucket `/quarantine/` com Object Lock; arquivo infectado não pode ser deletado imediatamente (auditoria forense + notificação tenant + decisão DPO)
- **ClamAV updates** — assinaturas atualizadas via cron + `freshclam`; falha de update dispara `system_alerts warning`; engine velha bloqueia upload (Fase 2)
- **Mídia clínica grande** (vídeo de evolução fisio até 500MB) — pipeline assíncrono com chunked upload (Tus protocol ou multipart resumable); scan acontece após upload completo
- **Cross-tenant leak via shared bucket prefix** — sempre `/{tenant_id}/{...}` no path; signed URL valida tenant via JWT + path
- **Retenção pós-rejeição** — arquivo infectado/inválido fica 90d em quarantine para auditoria; depois drop com confirmação dupla DPO + tenant_owner
- **Hash de conteúdo published** — SHA-256 entra em `upload_scans.content_hash` + `audit_log` quando arquivo é vinculado a domínio sensível (prescrição, evolução, exame, NF-e); permite verificar reuse + tampering

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Zero-day em parser de PDF do viewer browser do operador | LogiFit não controla browser do user | CSP + iframe sandbox + recomendação de browser atualizado em `/app/settings/security` |
| ClamAV não detecta malware desconhecido (signature-based) | Limitação fundamental de antivírus | Defesa em camadas: magic bytes + embed bloqueado + sandbox viewer; Fase 3 considerar ML-based scan ou serviço terceiro |
| Cliente envia PDF com analitos errados intencionalmente para exame | LogiFit não valida verdade clínica | Profissional revisa interpretação IA (regra 28); fluxo de exame exige confirmação humana antes de publicar ao paciente |

## Referências

- [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 4)
- [Regra 38 — scanUpload + ClamAV](../rules.md)
- [Regra 36 — rate limit](../rules.md)
- [Regra 39 — audit_log hash chain](../rules.md)
- [docs/compliance/dpo.md](../compliance/dpo.md) — Cloudflare R2 / Supabase Storage sub-processors
