import { db } from '@repo/db/client'
import { evolucaoAttachments, evolucoesSessao, members, persons } from '@repo/db/schema'
/**
 * `/app/fisio/evolucoes/[id]` — detalhe + anexos (Sprint 21 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { AddAttachmentForm } from './add-attachment-form'
import { EvolucaoEditor } from './evolucao-editor'
import { LockEvolucaoButton } from './lock-evolucao-button'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  exame_imagem: '🩻 Exame imagem',
  video_execucao: '🎥 Vídeo execução',
  documento: '📄 Documento',
  foto_postural: '📷 Foto postural',
  audio_anamnese: '🎙 Áudio anamnese',
}

const SCAN_BADGE: Record<string, { label: string; bg: string }> = {
  pending: { label: '⏳ Scan pendente', bg: 'var(--ev-warning-soft, #fef9c3)' },
  clean: { label: '✓ Scan OK', bg: 'var(--ev-success-soft, #dcfce7)' },
  rejected: { label: '⚠ Scan rejeitou', bg: 'var(--ev-danger-soft, #fee2e2)' },
  soft_deleted: { label: '🗑 Removido', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

interface Soap {
  subjetivo?: string | null
  objetivo?: string | null
  avaliacao?: string | null
  plano?: string | null
}

export default async function EvolucaoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireFullSession(`/app/fisio/evolucoes/${id}`)
  const tenantId = session.logifit.tenantId

  const [e] = await db
    .select({
      id: evolucoesSessao.id,
      memberId: evolucoesSessao.memberId,
      memberName: persons.name,
      status: evolucoesSessao.status,
      soap: evolucoesSessao.soap,
      freeText: evolucoesSessao.freeText,
      signedAt: evolucoesSessao.signedAt,
      signedHash: evolucoesSessao.signedHash,
      lockedAt: evolucoesSessao.lockedAt,
      signatureProvider: evolucoesSessao.signatureProvider,
      professionalUserId: evolucoesSessao.professionalUserId,
      createdAt: evolucoesSessao.createdAt,
      appointmentId: evolucoesSessao.appointmentId,
    })
    .from(evolucoesSessao)
    .leftJoin(members, eq(members.id, evolucoesSessao.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(evolucoesSessao.id, id), eq(evolucoesSessao.tenantId, tenantId)))
    .limit(1)
  if (!e) notFound()

  const attachments = await db
    .select({
      id: evolucaoAttachments.id,
      kind: evolucaoAttachments.kind,
      filename: evolucaoAttachments.filename,
      mimeType: evolucaoAttachments.mimeType,
      sizeBytes: evolucaoAttachments.sizeBytes,
      scanStatus: evolucaoAttachments.scanStatus,
      scanReason: evolucaoAttachments.scanReason,
      caption: evolucaoAttachments.caption,
      uploadedAt: evolucaoAttachments.uploadedAt,
      softDeletedAt: evolucaoAttachments.softDeletedAt,
    })
    .from(evolucaoAttachments)
    .where(
      and(
        eq(evolucaoAttachments.evolucaoId, id),
        eq(evolucaoAttachments.tenantId, tenantId),
        isNull(evolucaoAttachments.softDeletedAt),
      ),
    )
    .orderBy(asc(evolucaoAttachments.uploadedAt))

  const soap = (e.soap as unknown as Soap) ?? {}
  const isDraft = e.status === 'draft'
  const isAuthor = e.professionalUserId === session.user.id

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--ev-space-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>Evolução de sessão</h1>
        <span className="ev-badge">{e.status}</span>
        <span style={{ color: 'var(--ev-muted)' }}>{e.memberName ?? '—'}</span>
        <span style={{ flex: 1 }} />
        <Link href={`/app/fisio/pacientes/${e.memberId}/evolucoes`} className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <EvolucaoEditor
        evolucaoId={id}
        soap={{
          subjetivo: soap.subjetivo ?? '',
          objetivo: soap.objetivo ?? '',
          avaliacao: soap.avaliacao ?? '',
          plano: soap.plano ?? '',
        }}
        freeText={e.freeText ?? ''}
        readonly={!isDraft || !isAuthor}
      />

      <h2>Anexos ({attachments.length})</h2>
      {isDraft && isAuthor && <AddAttachmentForm evolucaoId={id} />}

      {attachments.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>Nenhum anexo. Adicione exame / vídeo / foto.</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Filename</th>
              <th>Tamanho</th>
              <th>MIME</th>
              <th>Scan</th>
              <th>Subido em</th>
            </tr>
          </thead>
          <tbody>
            {attachments.map((a) => {
              const sb = SCAN_BADGE[a.scanStatus] ?? {
                label: a.scanStatus,
                bg: 'var(--ev-surface)',
              }
              return (
                <tr key={a.id}>
                  <td>{KIND_LABEL[a.kind] ?? a.kind}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.filename}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {(Number(a.sizeBytes) / 1024).toFixed(1)} KB
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.mimeType}</td>
                  <td>
                    <span className="ev-badge" style={{ background: sb.bg }}>
                      {sb.label}
                    </span>
                    {a.scanReason && (
                      <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                        {a.scanReason}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(a.uploadedAt).toLocaleString('pt-BR')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {isDraft && isAuthor && (
        <>
          <h2>Fechar evolução</h2>
          <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <p style={{ marginTop: 0 }}>
              Calcula hash SHA-256 do SOAP+freeText+attachmentIds e marca como fechada. Lacre
              autenticado (default) = MFA recente + audit chain; ICP-Brasil = opcional pra fisio
              (COFFITO 414).
            </p>
            <LockEvolucaoButton evolucaoId={id} />
          </div>
        </>
      )}

      {!isDraft && (
        <>
          <h2>🔒 Lacre</h2>
          <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
            <div style={{ fontSize: 'var(--ev-font-xs)' }}>
              <strong>Hash SHA-256 (regra 39):</strong>
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 'var(--ev-font-xs)',
                wordBreak: 'break-all',
              }}
            >
              {e.signedHash ?? '—'}
            </div>
            <div style={{ marginTop: 8, fontSize: 'var(--ev-font-xs)' }}>
              <strong>Fechada em:</strong>{' '}
              {e.lockedAt ? new Date(e.lockedAt).toLocaleString('pt-BR') : '—'}
              {e.signedAt && (
                <>
                  {' '}
                  · <strong>Assinada ICP em:</strong> {new Date(e.signedAt).toLocaleString('pt-BR')}
                </>
              )}
            </div>
            {e.signatureProvider && (
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Provider: {e.signatureProvider}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
