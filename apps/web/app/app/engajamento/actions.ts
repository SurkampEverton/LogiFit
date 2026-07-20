'use server'

/**
 * Server Actions de engajamento — Sprint 09 Faixa C (ADR 0021 esperado).
 *
 * MVP:
 *   - listMemberAchievements (widget perfil member)
 *   - listMemberGoals (widget perfil member)
 *
 * Sprint 09+ Faixa D: createAchievement / grantReward / createGoal /
 * recordGoalMeasurement + dispatcher cross-alert.
 */

import { db } from '@repo/db/client'
import { achievements, goals, memberAchievements } from '@repo/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const ListMemberInputSchema = z.object({
  memberId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(5),
})

// ─── listMemberAchievements ───────────────────────────────────────────────

export const listMemberAchievements = wrapServerAction(
  { module: 'engajamento', action: 'achievement.list_by_member' },
  async (input: z.infer<typeof ListMemberInputSchema>, { session }) => {
    const parsed = ListMemberInputSchema.parse(input)
    const rows = await db
      .select({
        id: memberAchievements.achievementId,
        earnedAt: memberAchievements.earnedAt,
        achievementName: achievements.name,
        achievementIconUrl: achievements.iconUrl,
        points: achievements.points,
      })
      .from(memberAchievements)
      .innerJoin(achievements, eq(achievements.id, memberAchievements.achievementId))
      .where(
        and(
          eq(memberAchievements.tenantId, session.logifit.tenantId),
          eq(memberAchievements.memberId, parsed.memberId),
        ),
      )
      .orderBy(desc(memberAchievements.earnedAt))
      .limit(parsed.limit)

    return { earnedAchievements: rows }
  },
)

// ─── listMemberGoals ──────────────────────────────────────────────────────

export const listMemberGoals = wrapServerAction(
  { module: 'engajamento', action: 'goal.list_by_member' },
  async (input: z.infer<typeof ListMemberInputSchema>, { session }) => {
    const parsed = ListMemberInputSchema.parse(input)
    const rows = await db
      .select({
        id: goals.id,
        kind: goals.kind,
        title: goals.title,
        targetValue: goals.targetValue,
        currentValue: goals.currentValue,
        targetUnit: goals.targetUnit,
        targetDate: goals.targetDate,
        status: goals.status,
      })
      .from(goals)
      .where(
        and(
          eq(goals.tenantId, session.logifit.tenantId),
          eq(goals.memberId, parsed.memberId),
          eq(goals.status, 'active'),
        ),
      )
      .orderBy(desc(goals.createdAt))
      .limit(parsed.limit)

    return { activeGoals: rows }
  },
)
