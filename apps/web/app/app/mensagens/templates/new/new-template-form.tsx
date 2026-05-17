'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createTemplate } from '../../actions'

export function NewTemplateForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [channel, setChannel] = useState<'whatsapp' | 'email' | 'sms'>('whatsapp')
  const [body, setBody] = useState('Olá {{member.name}}, ')

  const detectedVars = useMemo(() => {
    const found = new Set<string>()
    for (const m of body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      if (m[1]) found.add(m[1])
    }
    return Array.from(found).sort()
  }, [body])

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const slug = String(fd.get('slug') ?? '').trim()
    const name = String(fd.get('name') ?? '').trim()
    const subject = String(fd.get('subject') ?? '').trim()

    if (!slug || !name || !body) {
      setError('Slug, nome e corpo obrigatórios')
      return
    }
    if (!/^[a-z0-9_]+$/.test(slug)) {
      setError('Slug aceita só letras minúsculas, números e underscore')
      return
    }
    if (channel === 'email' && !subject) {
      setError('Email exige subject')
      return
    }

    startTransition(async () => {
      const result = await createTemplate({
        channel,
        slug,
        name,
        subject: subject || undefined,
        body,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/mensagens/templates')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-[color:var(--ev-border)] p-6">
      {error && (
        <div
          role="alert"
          className="rounded-md border p-3 text-sm"
          style={{
            borderColor: 'var(--ev-danger, #ef4444)',
            color: 'var(--ev-danger, #ef4444)',
          }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Canal *</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Slug *</span>
          <input
            name="slug"
            type="text"
            required
            pattern="[a-z0-9_]+"
            placeholder="cobranca_d1"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Nome *</span>
          <input
            name="name"
            type="text"
            required
            placeholder="Cobrança D+1"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        {channel === 'email' && (
          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="block font-medium">Assunto (email) *</span>
            <input
              name="subject"
              type="text"
              placeholder="Sua fatura está atrasada"
              className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
            />
          </label>
        )}
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Corpo *</span>
          <textarea
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Olá {{member.name}}, sua fatura..."
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2 font-mono text-sm"
          />
        </label>
      </div>

      <div className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 space-y-2">
        <div className="text-xs uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Variáveis detectadas ({detectedVars.length})
        </div>
        {detectedVars.length === 0 ? (
          <p className="text-xs italic text-[color:var(--ev-text-muted)]">
            Use <code>{`{{var.path}}`}</code> no corpo pra criar variáveis.
          </p>
        ) : (
          <div className="flex gap-1 flex-wrap">
            {detectedVars.map((v) => (
              <code
                key={v}
                className="rounded-full bg-[color:var(--ev-surface)] px-2 py-0.5 text-[11px]"
              >
                {`{{${v}}}`}
              </code>
            ))}
          </div>
        )}
        <p className="text-[10px] text-[color:var(--ev-text-muted)]">
          Sugestões:{' '}
          <code>{`{{member.name}}`}</code>, <code>{`{{member.email}}`}</code>,{' '}
          <code>{`{{invoice.amount}}`}</code>,{' '}
          <code>{`{{invoice.due_date}}`}</code>
        </p>
      </div>

      <p className="text-xs text-[color:var(--ev-text-muted)]">
        {channel === 'whatsapp'
          ? 'WhatsApp: template entra como draft. Submeta ao Meta via aprovação na próxima fase Sprint 13b.'
          : channel === 'email'
            ? 'Email: aprovado automaticamente (sem fluxo Meta).'
            : 'SMS: aprovado automaticamente.'}
      </p>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar template'}
        </button>
      </div>
    </form>
  )
}
