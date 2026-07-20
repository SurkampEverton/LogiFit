/**
 * Passport invite sharing — helpers pra compartilhar invite-link (Sprint 02b8).
 *
 * 3 canais possíveis pra entregar o link `/i/<token>` ao paciente:
 *
 * 1. **Email automático** (quando `person.email` existe) — disparado por
 *    `dispatchPassportInviteEmail` em `sendPatientInvite` via Brevo SMTP.
 *
 * 2. **WhatsApp via staff** (quando `person.phone` existe) — staff clica
 *    botão na UI → abre WhatsApp Web com chat direcionado AO paciente +
 *    mensagem pré-formatada contendo o link. Staff só revisa/aperta send.
 *    Gratuito (link `wa.me` não cobra).
 *
 * 3. **Copy link manual** (sempre disponível) — staff copia URL e envia
 *    por qualquer canal (Telegram, SMS pessoal, papel, etc).
 *
 * Helper é **pure function** (sem side effects) — Server Action chama e
 * retorna ao caller pra UI renderizar botões/inputs apropriados.
 *
 * Sprint 02b9+: substituir `LOGIFIT_WHATSAPP_NUMBER` (env global) por
 * `tenant_branding.whatsapp_e164` por-tenant.
 */

const MODULE_LABELS: Record<string, string> = {
  academia: 'Academia',
  personal_training: 'Personal Training',
  fisioterapia: 'Fisioterapia',
  nutricao: 'Nutrição',
  pilates: 'Pilates',
}

function labelModules(modules: string[]): string {
  if (modules.length === 0) return 'nossos serviços'
  const labels = modules.map((m) => MODULE_LABELS[m] ?? m)
  if (labels.length === 1) return labels[0]!
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`
}

export interface BuildPatientWhatsappShareInput {
  /** Telefone do paciente em E.164 sem `+` (ex: `5511987654321`). */
  patientPhone: string
  /** Nome do paciente (display name de persons.name). */
  patientName: string
  /** Nome da clínica/academia. */
  tenantName: string
  /** Módulos solicitados pra contextualizar a mensagem. */
  modules: string[]
  /** URL completa de aceite (`${baseUrl}/i/<token>`). */
  inviteUrl: string
}

/**
 * Gera URL `wa.me/<paciente>?text=<msg+link>` que o STAFF clica pra abrir
 * WhatsApp Web/app com chat direcionado ao paciente + mensagem pronta com
 * o link de invite. Staff só revisa e aperta enviar.
 *
 * Mensagem é **redigida em nome da clínica** (não do LogiFit) — paciente
 * recebe mensagem do número da clínica/staff, mais natural que receber
 * de número desconhecido LogiFit.
 *
 * Retorna `null` se phone vazio/inválido (caller mostra apenas botão
 * "Copy link" como fallback).
 */
export function buildPatientWhatsappShareUrl(input: BuildPatientWhatsappShareInput): string | null {
  const phoneDigits = input.patientPhone.replace(/\D/g, '')
  if (!phoneDigits || phoneDigits.length < 10) return null

  const firstName = input.patientName.split(' ')[0] ?? input.patientName
  const modulesText = labelModules(input.modules)
  const msg = [
    `Olá, ${firstName}!`,
    '',
    `Aqui é da ${input.tenantName}. Estamos te convidando pra vincular sua conta LogiFit pra ${modulesText}.`,
    '',
    'Clique no link pra revisar e aceitar:',
    input.inviteUrl,
    '',
    'Ao aceitar, você escolhe quais dados clínicos liberar pra gente. Pode revogar a qualquer momento.',
    '',
    'Qualquer dúvida, fala comigo aqui mesmo!',
  ].join('\n')

  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`
}

/**
 * Resolve URL canônica do invite a partir do linkId + base URL configurada.
 * Pure function — testável sem env mock se baseUrl passado explicitamente.
 */
export function buildInviteUrl(linkId: string, baseUrl?: string): string {
  const base = baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.logifit.com.br'
  return `${base}/i/${linkId}`
}

/**
 * Resultado consolidado pra UI renderizar 3 canais.
 *
 *   - `inviteUrl` SEMPRE preenchido (staff pode copiar manualmente)
 *   - `emailSent` indica se email auto foi disparado (true), falhou (false),
 *     ou nem tentou pq person sem email (null)
 *   - `whatsappShareUrl` preenchido se person tem phone — null caso contrário
 */
export interface PatientInviteChannels {
  inviteUrl: string
  emailSent: boolean | null
  whatsappShareUrl: string | null
}
