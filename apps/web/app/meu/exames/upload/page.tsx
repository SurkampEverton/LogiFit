/**
 * /meu/exames/upload — paciente sobe exame. Sprint 33 Faixa C.
 *
 * MVP: aceita storagePath manual (Sprint 33b: drag-drop + MinIO + scanUpload).
 */
import Link from 'next/link'
import { requireMemberSession } from '../../../lib/member-session'

export const dynamic = 'force-dynamic'

export default async function UploadExamPage() {
  await requireMemberSession('/meu/exames/upload')

  return (
    <div className="ev-portal-page">
      <header>
        <h1 className="ev-portal-h1">Enviar exame</h1>
        <p className="ev-portal-muted">
          Envie o PDF do seu laudo laboratorial. A IA pré-analisa em segundos e o profissional
          revisa antes de adicionar ao seu histórico oficial.
        </p>
      </header>

      <div className="ev-portal-callout">
        <h2 className="ev-portal-h2">Upload em breve</h2>
        <p>
          O upload via drag-drop entra na próxima versão (Sprint 33b — depende da integração
          MinIO + scan de segurança).
        </p>
        <p>
          Por enquanto: <strong>envie por WhatsApp da clínica</strong>. O sistema reconhece
          como exame e processa automaticamente.
        </p>
      </div>

      <Link href="/meu/exames" className="ev-portal-button ev-portal-button--ghost">
        ← Voltar
      </Link>
    </div>
  )
}
