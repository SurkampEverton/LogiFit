/**
 * `/app/members/[id]/qr` — QR rotativo do member pra catraca (Sprint 08 Faixa C).
 *
 * Server Component lookup nome do member; passa pra `<MemberQrDisplay>` (Client)
 * que faz polling em `/api/acesso/qr/[memberId]` e renderiza QR via lib leve.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMember } from '../../actions'
import { listMemberAccess } from '../../../acesso/actions'
import { MemberQrDisplay } from './member-qr-display'

export const dynamic = 'force-dynamic'

export default async function MemberQrPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const result = await getMember({ id })
  if (!result.ok || !result.data) notFound()
  const { member, person } = result.data

  const accessResult = await listMemberAccess({ memberId: id })
  const activeBlocks = accessResult.ok ? accessResult.data.activeBlocks : []

  return (
    <div className="mx-auto max-w-md px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link
          href={`/app/members/${id}`}
          className="text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar para perfil
        </Link>
      </nav>

      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{person.name}</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">QR de acesso · rotação 60s</p>
      </header>

      {member.archivedAt && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-warning, #f59e0b)] p-3 text-sm text-center"
        >
          ⚠ Member arquivado. QR pode não funcionar na catraca.
        </div>
      )}

      {activeBlocks.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--ev-danger)] p-3 text-sm space-y-1"
        >
          <p className="font-semibold text-[color:var(--ev-danger)]">🚫 Acesso bloqueado</p>
          {activeBlocks.map((b) => (
            <p key={b.id} className="text-xs text-[color:var(--ev-text-muted)]">
              <span className="font-medium">{b.kind}:</span> {b.reason}
            </p>
          ))}
        </div>
      )}

      <MemberQrDisplay memberId={id} />

      <p className="text-xs text-center text-[color:var(--ev-text-muted)]">
        Aproxime o celular do leitor da catraca. QR atualiza automaticamente a cada 60s
        — não precisa salvar print.
      </p>
    </div>
  )
}
