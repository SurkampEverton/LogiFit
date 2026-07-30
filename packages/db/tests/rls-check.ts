/**
 * RLS check — 3 verificações estáticas + 1 dinâmica (regra 1+2 enforced):
 *
 *   1. ESTÁTICA: toda tabela com `tenant_id` tem `relrowsecurity = true`
 *   2. ESTÁTICA: toda tabela RLS-enabled tem `relforcerowsecurity = true`
 *      (sem isso, table owner bypassa — falha de defesa em profundidade)
 *   3. ESTÁTICA: toda tabela RLS-enabled tem ao menos 1 policy
 *      (RLS sem policy = DENY tudo silenciosamente, normalmente bug)
 *   4. DINÂMICA (opcional, via ENV `RLS_CHECK_RUNTIME=1`): cria 2 tenants
 *      fictícios + insere 1 row em cada, valida que role `logifit_app`
 *      com `app.tenant_id` setado pra A só vê dado de A (não B)
 *
 * Tabelas exceções (sem tenant_id por design) ficam em ALLOWLIST. Adicionar
 * aqui exige justificativa via PR (ADR ou comentário no commit).
 */
import { Pool } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const RUNTIME = process.env.RLS_CHECK_RUNTIME === '1'

// Tabelas globais (sem tenant_id por design) — ADR/regra deve justificar
const ALLOWLIST_NO_TENANT = new Set([
  'cnpj_cache', // ADR 0048 — dado público Receita Federal compartilhado
  'groups', // ADR 0008 — camada agregada acima de tenant
  '__drizzle_migrations', // Drizzle journal interno
  '__drizzle_migrations_journal', // idem
])

/**
 * Famílias inteiras de tabela global, por prefixo.
 *
 * `tax_ref_*` são catálogo da legislação federal (CST de ICMS/PIS/COFINS/IPI,
 * CSOSN, origem, modBC, CFOP) — iguais para todos os tenants. Replicar por
 * tenant multiplicaria a manutenção sem isolar nada que seja de alguém.
 * Exceção declarada na regra 47, com precedente do ADR 0028 (CID/CIF).
 *
 * Prefixo em vez de listar uma a uma porque a família cresce: `tax_ref_ncm` e
 * `tax_ref_cest` entram quando houver caso de uso, e um allowlist que precisa
 * ser editado a cada tabela nova acaba sendo contornado.
 */
const ALLOWLIST_NO_TENANT_PREFIXES = ['tax_ref_']

interface CheckIssue {
  rule: string
  table: string
  detail: string
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const issues: CheckIssue[] = []

  try {
    // ─── 1. tabela com tenant_id sem RLS ────────────────────────────────
    const noRls = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND a.attname = 'tenant_id'
        AND a.attnum > 0
        AND NOT c.relrowsecurity
      ORDER BY c.relname;
    `)
    for (const row of noRls.rows) {
      issues.push({
        rule: 'tenant-id-needs-rls',
        table: row.table_name,
        detail: 'tem coluna tenant_id mas RLS desabilitada',
      })
    }

    // ─── 2. RLS sem FORCE ──────────────────────────────────────────────
    const noForce = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relrowsecurity
        AND NOT c.relforcerowsecurity
      ORDER BY c.relname;
    `)
    for (const row of noForce.rows) {
      issues.push({
        rule: 'rls-needs-force',
        table: row.table_name,
        detail:
          'RLS habilitada mas sem FORCE — table owner bypassa (defesa em profundidade quebrada)',
      })
    }

    // ─── 3. RLS sem nenhuma policy ─────────────────────────────────────
    const noPolicy = await pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname = 'public'
        AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
        )
      ORDER BY c.relname;
    `)
    for (const row of noPolicy.rows) {
      issues.push({
        rule: 'rls-needs-policy',
        table: row.table_name,
        detail: 'RLS habilitada mas SEM policies — vira DENY total (provavelmente bug)',
      })
    }

    // ─── 4. tabelas no allowlist devem realmente não ter tenant_id ─────
    // (sanity check — se alguém adicionar tenant_id em cnpj_cache por engano)
    //
    // Tabelas cobertas por prefixo entram na mesma verificação: ganhar um
    // `tenant_id` sem sair do allowlist deixaria a tabela sem RLS **e** com
    // dado de tenant — exatamente o cenário que a regra 1 existe para impedir.
    const prefixed = await pool.query<{ table_name: string }>(
      `
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND ${ALLOWLIST_NO_TENANT_PREFIXES.map((_, i) => `table_name LIKE $${i + 1}`).join(' OR ')};
      `,
      ALLOWLIST_NO_TENANT_PREFIXES.map((p) => `${p}%`),
    )
    const allowedTables = [...ALLOWLIST_NO_TENANT, ...prefixed.rows.map((r) => r.table_name)]

    for (const allowed of allowedTables) {
      if (allowed.startsWith('__drizzle')) continue
      const r = await pool.query<{ exists: boolean }>(
        `
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = 'tenant_id'
        ) AS exists;
        `,
        [allowed],
      )
      if (r.rows[0]?.exists) {
        issues.push({
          rule: 'allowlist-needs-update',
          table: allowed,
          detail: 'está no allowlist NO_TENANT mas tem coluna tenant_id — remover do allowlist',
        })
      }
    }

    // ─── 5. RUNTIME (opcional): isolamento real via role logifit_app ───
    if (RUNTIME) {
      console.log('• runtime check: isolando tenants via role logifit_app')
      await runtimeCheck(pool, issues)
    }

    // ─── Report ─────────────────────────────────────────────────────────
    if (issues.length === 0) {
      const checks = ['rls-enabled', 'rls-forced', 'rls-has-policy']
      if (RUNTIME) checks.push('runtime-isolation')
      console.log(`✓ rls-check: ${checks.length} regras OK em todas as tabelas`)
      return
    }

    console.error(`✗ rls-check FALHA — ${issues.length} violações:`)
    const byRule = new Map<string, CheckIssue[]>()
    for (const issue of issues) {
      const list = byRule.get(issue.rule) ?? []
      list.push(issue)
      byRule.set(issue.rule, list)
    }
    for (const [rule, list] of byRule) {
      console.error(`\n[${rule}] ${list.length} tabela(s):`)
      for (const item of list) {
        console.error(`  • ${item.table} — ${item.detail}`)
      }
    }
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

async function runtimeCheck(pool: Pool, issues: CheckIssue[]): Promise<void> {
  // UUIDs aleatórios + sufixo único no slug — ROLLBACK garante limpeza no
  // happy path; se transação for interrompida (kill), o suffixo timestamp
  // evita colisão na próxima execução.
  const ts = Date.now()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Cria 2 tenants com IDs gerados pelo Postgres + captura via RETURNING
    const tenantsResult = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, topology) VALUES
       ('RLS Check A', $1, 'owned'),
       ('RLS Check B', $2, 'owned')
       RETURNING id`,
      [`rls-check-a-${ts}`, `rls-check-b-${ts}`],
    )
    const tenantA = tenantsResult.rows[0]?.id
    const tenantB = tenantsResult.rows[1]?.id
    if (!tenantA || !tenantB) {
      throw new Error('falha ao criar tenants para runtime check')
    }
    await client.query(
      `INSERT INTO persons (tenant_id, kind, name, document) VALUES
       ($1, 'pf', 'Maria A', '11144477735'),
       ($2, 'pf', 'João B', '52998224725')`,
      [tenantA, tenantB],
    )

    // Switch pra role app + set tenant A → deve ver só Maria
    await client.query('SET LOCAL ROLE logifit_app')
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA])

    const seenA = await client.query<{ name: string }>('SELECT name FROM persons')
    if (seenA.rows.length !== 1 || seenA.rows[0]?.name !== 'Maria A') {
      issues.push({
        rule: 'runtime-isolation',
        table: 'persons',
        detail: `tenant A viu ${seenA.rows.length} rows (esperado 1: 'Maria A'); rows=${JSON.stringify(seenA.rows)}`,
      })
    }

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB])
    const seenB = await client.query<{ name: string }>('SELECT name FROM persons')
    if (seenB.rows.length !== 1 || seenB.rows[0]?.name !== 'João B') {
      issues.push({
        rule: 'runtime-isolation',
        table: 'persons',
        detail: `tenant B viu ${seenB.rows.length} rows (esperado 1: 'João B'); rows=${JSON.stringify(seenB.rows)}`,
      })
    }

    await client.query('RESET ROLE')
    await client.query('ROLLBACK')
  } finally {
    client.release()
  }
}

main().catch((err) => {
  console.error('rls-check error:', err)
  process.exit(1)
})
