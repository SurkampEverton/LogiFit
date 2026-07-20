'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createRegua } from '../../actions'

interface Template {
  id: string
  slug: string
  name: string
  channel: 'whatsapp' | 'email' | 'sms'
  approvalStatus: string
}

interface ActionDraft {
  kind: 'send_message' | 'wait'
  channel?: 'whatsapp' | 'email' | 'sms'
  templateSlug?: string
  delayDays: number
}

const TRIGGER_EVENTS = [
  { value: 'invoice.overdue', label: '💸 Fatura atrasada' },
  { value: 'member.no_checkin_15d', label: '😴 Sem check-in há 15d' },
  { value: 'member.no_checkin_30d', label: '😴 Sem check-in há 30d' },
  { value: 'lead.no_response_3d', label: '👻 Lead sem resposta 3d' },
  { value: 'appointment.tomorrow', label: '📅 Agendamento amanhã' },
  { value: 'achievement.earned', label: '🏆 Conquista desbloqueada' },
]

const STOP_EVENTS = [
  { value: 'invoice.paid', label: 'Fatura paga' },
  { value: 'invoice.cancelled', label: 'Fatura cancelada' },
]

export function NewReguaForm({ templates }: { templates: Template[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [triggerEvent, setTriggerEvent] = useState('invoice.overdue')
  const [stopOn, setStopOn] = useState<string[]>(['invoice.paid'])
  const [actions, setActions] = useState<ActionDraft[]>([
    { kind: 'send_message', channel: 'whatsapp', templateSlug: '', delayDays: 0 },
  ])

  function addAction() {
    setActions((prev) => [
      ...prev,
      { kind: 'send_message', channel: 'whatsapp', templateSlug: '', delayDays: 1 },
    ])
  }
  function removeAction(idx: number) {
    setActions((prev) => prev.filter((_, i) => i !== idx))
  }
  function updateAction(idx: number, patch: Partial<ActionDraft>) {
    setActions((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)))
  }

  function toggleStopEvent(ev: string) {
    setStopOn((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]))
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    const name = String(fd.get('name') ?? '').trim()
    const description = String(fd.get('description') ?? '').trim()

    if (!name) {
      setError('Nome obrigatório')
      return
    }
    if (actions.length === 0) {
      setError('Adicione ao menos 1 ação')
      return
    }
    for (const a of actions) {
      if (a.kind === 'send_message' && (!a.templateSlug || !a.channel)) {
        setError('Toda ação send_message precisa de canal + template_slug')
        return
      }
    }

    const dsl = {
      trigger: { event: triggerEvent as (typeof TRIGGER_EVENTS)[number]['value'] },
      actions: actions.map((a) =>
        a.kind === 'send_message'
          ? {
              kind: 'send_message' as const,
              channel: a.channel ?? 'whatsapp',
              template_slug: a.templateSlug ?? '',
              delay_days: a.delayDays,
            }
          : {
              kind: 'wait' as const,
              delay_days: a.delayDays,
            },
      ),
      stop_on: stopOn.length > 0 ? stopOn : undefined,
      guards: { consent: 'marketing_messages' as const, rate_limit_per_member_24h: 3 },
    }

    startTransition(async () => {
      const result = await createRegua({
        name,
        description: description || undefined,
        // biome-ignore lint/suspicious/noExplicitAny: DSL é validada server-side via ReguaDslSchema
        dsl: dsl as any,
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.push('/app/mensagens/reguas')
      router.refresh()
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
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

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Identificação
        </h2>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Nome *</span>
          <input
            name="name"
            type="text"
            required
            placeholder="Cobrança D+1/+3/+7"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Descrição</span>
          <textarea
            name="description"
            rows={2}
            placeholder="Lembrete progressivo via WhatsApp + email"
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          />
        </label>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Trigger
        </h2>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Evento que dispara</span>
          <select
            value={triggerEvent}
            onChange={(e) => setTriggerEvent(e.target.value)}
            className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-3 py-2"
          >
            {TRIGGER_EVENTS.map((ev) => (
              <option key={ev.value} value={ev.value}>
                {ev.label} ({ev.value})
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Ações ({actions.length})
          </h2>
          <button
            type="button"
            onClick={addAction}
            className="rounded-md border border-[color:var(--ev-border)] px-3 py-1.5 text-xs hover:bg-[color:var(--ev-surface)]"
          >
            + Adicionar ação
          </button>
        </header>

        {actions.map((a, idx) => (
          <div
            key={idx}
            className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3 space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">Ação {idx + 1}</span>
              {actions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAction(idx)}
                  className="hover:underline"
                  style={{ color: 'var(--ev-danger, #ef4444)' }}
                >
                  remover
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Tipo</span>
                <select
                  value={a.kind}
                  onChange={(e) =>
                    updateAction(idx, { kind: e.target.value as ActionDraft['kind'] })
                  }
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                >
                  <option value="send_message">📤 Send message</option>
                  <option value="wait">⏱️ Wait</option>
                </select>
              </label>
              {a.kind === 'send_message' && (
                <>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Canal</span>
                    <select
                      value={a.channel}
                      onChange={(e) =>
                        updateAction(idx, {
                          channel: e.target.value as ActionDraft['channel'],
                        })
                      }
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    >
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                    </select>
                  </label>
                  <label className="space-y-0.5 text-xs">
                    <span className="block font-medium">Template slug</span>
                    <select
                      value={a.templateSlug ?? ''}
                      onChange={(e) => updateAction(idx, { templateSlug: e.target.value })}
                      className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                    >
                      <option value="">(escolha)</option>
                      {templates
                        .filter((t) => t.channel === a.channel)
                        .map((t) => (
                          <option key={t.id} value={t.slug}>
                            {t.slug} {t.approvalStatus !== 'approved' && '(não aprovado)'}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              <label className="space-y-0.5 text-xs">
                <span className="block font-medium">Delay (dias)</span>
                <input
                  type="number"
                  min={a.kind === 'wait' ? 1 : 0}
                  max="365"
                  value={a.delayDays}
                  onChange={(e) => updateAction(idx, { delayDays: Number(e.target.value) })}
                  className="w-full rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] px-2 py-1"
                />
              </label>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Stop on (eventos que param execução)
        </h2>
        <div className="space-y-2">
          {STOP_EVENTS.map((ev) => (
            <label key={ev.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={stopOn.includes(ev.value)}
                onChange={() => toggleStopEvent(ev.value)}
              />
              <span>{ev.label}</span>
              <code className="text-[10px] text-[color:var(--ev-text-muted)]">{ev.value}</code>
            </label>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? 'Criando...' : 'Criar régua (inativa)'}
        </button>
      </div>
      <p className="text-xs text-[color:var(--ev-text-muted)] text-right">
        Régua nasce <strong>inativa</strong>. Use o toggle na lista pra ativar quando templates
        estiverem aprovados.
      </p>
    </form>
  )
}
