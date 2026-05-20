/**
 * QR code render — wrapper isolado pra lib `qrcode` ([ADR 0095](../../../../docs/decisions/0095-qrcode-lib-mfa-totp.md)).
 *
 * **Regra 46:** lib `qrcode` é dependência externa justificada pelo ADR 0095.
 * Outros usos (boletos, contratos, etc) exigem extensão deliberada deste wrapper —
 * NÃO importar `qrcode` direto em outros arquivos.
 *
 * **Render server-side**: gera SVG string que vai no HTML inicial. Zero bundle JS no client.
 * Caller injeta via `dangerouslySetInnerHTML` (SVG é seguro — gerado pelo nosso código,
 * sem input externo no markup).
 */
import QRCode from 'qrcode'

/**
 * Gera SVG de QR code pro URI `otpauth://totp/...` do wizard MFA TOTP.
 *
 * - Error correction level **M** (15% recovery) — equilíbrio entre densidade e robustez
 *   pra leitura por câmera de celular comum
 * - Margin 1 module — economiza espaço sem afetar leitura (default da lib é 4)
 * - Width 200px — caber em modal mobile sem precisar zoom
 * - Color preto sobre branco — máximo contraste, sem dependência de tema
 *
 * Retorna `<svg>...</svg>` standalone (sem `<?xml ... ?>` header — pra injetar em HTML).
 *
 * @throws Se URI for inválida ou exceder capacidade do QR (>2953 bytes byte-mode)
 */
export async function generateTotpQrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 200,
    color: {
      // design-token-exempt: preto puro é REQUISITO do algoritmo QR (contraste máximo).
      dark: '#000000',
      // design-token-exempt: branco puro é REQUISITO do algoritmo QR (contraste máximo).
      light: '#ffffff',
    },
  })
}
