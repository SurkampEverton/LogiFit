/**
 * `buildSystemPrompt({persona, tools, ragSnippets, tenantCtx, ...})` —
 * compositor canônico de system prompt (ADR 0064 + ADR 0075).
 *
 * Composição:
 *   1. Header (assistantName + LogiFit branding)
 *   2. Persona template (pt-BR/en-US/es-419)
 *   3. Hard rules globais (LGPD + CFM + nunca prescreve)
 *   4. Tools disponíveis (function descriptions)
 *   5. RAG snippets (se houver)
 *   6. Route context (ex: member_id quando em /app/members/abc)
 *   7. Tenant context (verticals, plano, locale)
 */
import { getPersonaPrompt } from './personas'
import type { AssistantSystemPromptInput } from './types'

const GLOBAL_HARD_RULES = {
  'pt-BR': `## REGRAS DURAS GLOBAIS

1. NUNCA PRESCREVE — medicamento, dose, exame, atestado, receita, autorização. Sempre sugere "procure profissional habilitado".
2. NUNCA DIAGNOSTICA — use "pode indicar", "sugere", "é compatível com". Decisão diagnóstica é do profissional.
3. NUNCA EXPÕE PII bruto desnecessário — CPF/RG aparecem mascarados. Mostre member_id + nome quando disponível.
4. NUNCA CRUZA TENANT — você só vê dados do tenant logado. Passaporte cross-tenant é decidido pelo paciente em UI dedicada.
5. CAMADA 3 (write) — SEMPRE use proposeAction(tool, args, reason). NUNCA chame handler direto. UI mostra confirmação ao usuário.
6. EM CASO DE DÚVIDA — abra ticket via report_issue. Não invente respostas.`,
  'en-US': `## HARD GLOBAL RULES

1. NEVER PRESCRIBE — medication, dose, test, certificate, prescription, authorization. Always suggest "see qualified professional".
2. NEVER DIAGNOSE — use "might indicate", "suggests", "compatible with". Diagnostic decision is the professional's.
3. NEVER EXPOSE raw PII unnecessarily — CPF/RG appear masked. Show member_id + name when available.
4. NEVER CROSS TENANT — you only see logged-in tenant data. Cross-tenant passport is patient-decided in dedicated UI.
5. LAYER 3 (write) — ALWAYS use proposeAction(tool, args, reason). NEVER call handler directly. UI shows confirmation to user.
6. IF IN DOUBT — open ticket via report_issue. Don't invent answers.`,
  'es-419': `## REGLAS DURAS GLOBALES

1. NUNCA PRESCRIBE — medicación, dosis, examen, certificado, receta, autorización. Siempre sugiere "buscar profesional habilitado".
2. NUNCA DIAGNOSTICA — use "puede indicar", "sugiere", "compatible con". Decisión diagnóstica es del profesional.
3. NUNCA EXPONE PII bruto innecesario — CPF/RG aparecen enmascarados. Muestre member_id + nombre cuando disponible.
4. NUNCA CRUZA TENANT — solo ve datos del tenant logueado. Pasaporte cross-tenant lo decide el paciente en UI dedicada.
5. CAPA 3 (write) — SIEMPRE use proposeAction(tool, args, reason). NUNCA llame handler directo. UI muestra confirmación al usuario.
6. EN DUDA — abra ticket vía report_issue. No invente respuestas.`,
}

export function buildSystemPrompt(input: AssistantSystemPromptInput): string {
  const { persona, tenantCtx, availableTools, assistantName, ragSnippets, routeContext } = input
  const locale = tenantCtx.locale

  const header = `Você é "${assistantName}", o assistente do LogiFit.`

  const personaBlock = getPersonaPrompt(persona, locale)
  const rules = GLOBAL_HARD_RULES[locale]

  // Tools formatadas como function spec resumido (LLM consome via tool_calls
  // tipados nas APIs Vercel AI SDK; system prompt menciona pra orientação).
  const toolsBlock =
    availableTools.length === 0
      ? '_(no tools available)_'
      : availableTools
          .map(
            (t) =>
              `- \`${t.key}\` (${t.layer}${t.requiresConfirmation ? ', requires confirmation' : ''}): ${t.description}`,
          )
          .join('\n')

  const ragBlock =
    ragSnippets && ragSnippets.length > 0
      ? `## CONTEXTO RAG (use como referência, cite a fonte)\n${ragSnippets
          .map((s, i) => `[${i + 1}] ${s.source}\n${s.content}`)
          .join('\n\n')}`
      : ''

  const routeBlock = routeContext
    ? `## CONTEXTO DE ROTA\n${Object.entries(routeContext)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')}`
    : ''

  const tenantBlock = `## TENANT
- tenant_id: ${tenantCtx.tenantId}
- plano: ${tenantCtx.planTier}
- verticais ativas: ${(tenantCtx.verticals ?? []).join(', ') || '(nenhuma)'}
- locale: ${tenantCtx.locale}`

  return [header, personaBlock, rules, '## TOOLS DISPONÍVEIS\n' + toolsBlock, ragBlock, routeBlock, tenantBlock]
    .filter(Boolean)
    .join('\n\n')
}
