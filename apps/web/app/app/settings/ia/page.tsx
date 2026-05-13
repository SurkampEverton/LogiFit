/**
 * `/app/settings/ia` — admin tenant: BYOK + cota + white-label (ADR 0064 +
 * ADR 0075).
 *
 * Sprint 06 Faixa D real: forms write para `tenantAssistantSettings` + BYOK.
 * Cota visualizada com barra %.
 */
import { db } from '@repo/db/client'
import {
  aiProviderConfigs,
  aiProviders,
  aiTenantUsage,
  tenantAssistantSettings,
} from '@repo/db/schema'
import { AI_PLAN_LIMITS } from '@repo/ai'
import { and, eq } from 'drizzle-orm'
import { getTranslations } from 'next-intl/server'
import { requireFullSession } from '../../../lib/session'
import { AssistantNameForm, ByokForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function SettingsIAPage() {
  const session = await requireFullSession('/app/settings/ia')
  const t = await getTranslations('ia')

  const monthBucket = new Date().toISOString().slice(0, 7)
  const [usage] = await db
    .select({
      calls: aiTenantUsage.callsCount,
      tokensIn: aiTenantUsage.tokensInput,
      tokensOut: aiTenantUsage.tokensOutput,
      cacheHits: aiTenantUsage.cacheHits,
    })
    .from(aiTenantUsage)
    .where(
      and(
        eq(aiTenantUsage.tenantId, session.logifit.tenantId),
        eq(aiTenantUsage.monthBucket, monthBucket),
      ),
    )
    .limit(1)

  // Settings (white-label name) — null se ainda não foi criado
  const [settings] = await db
    .select({
      assistantName: tenantAssistantSettings.assistantName,
    })
    .from(tenantAssistantSettings)
    .where(eq(tenantAssistantSettings.tenantId, session.logifit.tenantId))
    .limit(1)
  const assistantName = settings?.assistantName ?? 'Copilot'

  // Providers + status BYOK
  const providersRaw = await db
    .select({
      slug: aiProviders.slug,
      name: aiProviders.name,
      providerId: aiProviders.id,
    })
    .from(aiProviders)
    .where(eq(aiProviders.enabled, true))

  const byok = await db
    .select({
      providerId: aiProviderConfigs.providerId,
      enabled: aiProviderConfigs.enabled,
      lastTestedAt: aiProviderConfigs.lastTestedAt,
      lastTestResult: aiProviderConfigs.lastTestResult,
    })
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.tenantId, session.logifit.tenantId))

  const providersWithStatus = providersRaw.map((p) => {
    const config = byok.find((b) => b.providerId === p.providerId)
    return {
      slug: p.slug,
      name: p.name,
      configured: !!config,
      enabled: config?.enabled ?? false,
      lastTestedAt: config?.lastTestedAt ? config.lastTestedAt.toISOString() : null,
      lastTestResult: config?.lastTestResult ?? null,
    }
  })

  // Sprint 06+: ler tenants.plan_tier real. Stub assume Starter.
  const planTier: keyof typeof AI_PLAN_LIMITS = 'starter'
  const limits = AI_PLAN_LIMITS[planTier]
  const callsCount = usage?.calls ?? 0
  const percent = (callsCount / limits.monthly) * 100

  return (
    <main style={{ padding: 'var(--ev-space-5)', maxWidth: 720 }}>
      <header style={{ marginBottom: 'var(--ev-space-5)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--ev-text-2xl)' }}>{t('title')}</h1>
        <p style={{ margin: 'var(--ev-space-2) 0 0', color: 'var(--ev-text-muted)' }}>
          {t('subtitle')}
        </p>
      </header>

      {/* Cota */}
      <section
        style={{
          padding: 'var(--ev-space-4)',
          border: '1px solid var(--ev-border)',
          borderRadius: 12,
          marginBottom: 'var(--ev-space-4)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>{t('quota.title')}</h2>
        <p
          style={{
            margin: 'var(--ev-space-2) 0',
            fontSize: 'var(--ev-text-sm)',
            color: 'var(--ev-text-muted)',
          }}
        >
          {t('quota.plan_label', { plan: planTier })}
        </p>
        <div
          style={{
            height: 12,
            backgroundColor: 'var(--ev-surface-muted)',
            borderRadius: 9999,
            overflow: 'hidden',
            marginTop: 'var(--ev-space-3)',
          }}
        >
          <div
            style={{
              width: `${Math.min(percent, 100)}%`,
              height: '100%',
              backgroundColor:
                percent >= 90 ? 'var(--ev-danger, #ef4444)' : 'var(--ev-primary)',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 'var(--ev-space-2)',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          <span>{t('quota.used', { used: callsCount, limit: limits.monthly })}</span>
          <span>{Math.round(percent)}%</span>
        </div>
        <ul
          style={{
            margin: 'var(--ev-space-3) 0 0',
            paddingLeft: 'var(--ev-space-4)',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          <li>{t('quota.cache_hits', { hits: usage?.cacheHits ?? 0 })}</li>
          <li>{t('quota.tokens_in', { tokens: usage?.tokensIn ?? 0 })}</li>
          <li>{t('quota.tokens_out', { tokens: usage?.tokensOut ?? 0 })}</li>
        </ul>
      </section>

      {/* White-label */}
      <section
        style={{
          padding: 'var(--ev-space-4)',
          border: '1px solid var(--ev-border)',
          borderRadius: 12,
          marginBottom: 'var(--ev-space-4)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>{t('whitelabel.title')}</h2>
        <p
          style={{
            margin: 'var(--ev-space-2) 0',
            fontSize: 'var(--ev-text-sm)',
            color: 'var(--ev-text-muted)',
          }}
        >
          {t('whitelabel.description')}
        </p>
        <AssistantNameForm initialName={assistantName} />
      </section>

      {/* BYOK */}
      <section
        style={{
          padding: 'var(--ev-space-4)',
          border: '1px solid var(--ev-border)',
          borderRadius: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 'var(--ev-text-lg)' }}>{t('byok.title')}</h2>
        <p
          style={{
            margin: 'var(--ev-space-2) 0',
            fontSize: 'var(--ev-text-sm)',
            color: 'var(--ev-text-muted)',
          }}
        >
          {t('byok.description')}
        </p>
        <ByokForm providers={providersWithStatus} />
      </section>
    </main>
  )
}
