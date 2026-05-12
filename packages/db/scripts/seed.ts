/**
 * Seed canônico LogiFit — 4 cenários multi-empresa (Sprint 01a Faixa H).
 *
 * **5º cenário (modo solo)** depende de `tenants.mode='solo'` (Sprint 01b
 * ADR 0069). **Cenário 3 com passaporte completo** depende de
 * `patient_company_links` (Sprint 01b ADR 0077).
 *
 * UUIDs hardcoded determinísticos (`00000000-0000-1xxx-xxxx-yyyyyyyyyyyy`)
 * permitem assertion SELECT direto em testes sem precisar capturar
 * RETURNING. Convenção:
 *   - cenário 1 (rede própria):       UUIDs prefixo `00000001-0001-...`
 *   - cenário 2 (franquia clássica):  UUIDs prefixo `00000002-0001-...`
 *   - cenário 3 (rede + clínica):     UUIDs prefixo `00000003-...`
 *   - cenário 4 (mix loja+rede):      UUIDs prefixo `00000004-...`
 *
 * **Idempotente** via TRUNCATE com CASCADE no início. Roda como `postgres`
 * superuser pra bypassear RLS — seed é admin-only.
 *
 * Uso:
 *   pnpm db:seed   # apaga tudo + recria os 4 cenários
 *   pnpm db:seed --keep-existing  # só insere se não existir
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import {
  authUser,
  companies,
  groups,
  patientCompanyLinks,
  patientLinkModules,
  persons,
  roles,
  tenants,
  units,
  userRoles,
  userTenants,
  users,
} from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

const KEEP = process.argv.includes('--keep-existing')

// ─── Cenário 1: Rede própria (3 unidades) ─────────────────────────────────
const SCENARIO_1 = {
  groupId: '00000001-0001-0000-0000-000000000001',
  tenantId: '00000001-0001-0000-0000-000000000010',
  // Matriz
  matrizPersonId: '00000001-0001-0000-0000-0000000000a1',
  matrizCompanyId: '00000001-0001-0000-0000-0000000000c1',
  matrizUnitId: '00000001-0001-0000-0000-0000000000f1',
  // Filial Sul
  filialSulPersonId: '00000001-0001-0000-0000-0000000000a2',
  filialSulCompanyId: '00000001-0001-0000-0000-0000000000c2',
  filialSulUnitId: '00000001-0001-0000-0000-0000000000f2',
  // Filial Norte
  filialNortePersonId: '00000001-0001-0000-0000-0000000000a3',
  filialNorteCompanyId: '00000001-0001-0000-0000-0000000000c3',
  filialNorteUnitId: '00000001-0001-0000-0000-0000000000f3',
  // User admin
  adminAuthUserId: '00000001-0001-0000-0000-0000000000d1',
  adminPersonId: '00000001-0001-0000-0000-0000000000b1',
  adminUserId: '00000001-0001-0000-0000-0000000000e1',
}

// ─── Cenário 2: Franquia clássica (1 franqueador + 2 franqueados) ────────
const SCENARIO_2 = {
  groupId: '00000002-0001-0000-0000-000000000001',
  tenantId: '00000002-0001-0000-0000-000000000010',
  franqueadorPersonId: '00000002-0001-0000-0000-0000000000a1',
  franqueadorCompanyId: '00000002-0001-0000-0000-0000000000c1',
  franqueadorUnitId: '00000002-0001-0000-0000-0000000000f1',
  // Franqueados (filiais)
  franqA: {
    personId: '00000002-0001-0000-0000-0000000000a2',
    companyId: '00000002-0001-0000-0000-0000000000c2',
    unitId: '00000002-0001-0000-0000-0000000000f2',
  },
  franqB: {
    personId: '00000002-0001-0000-0000-0000000000a3',
    companyId: '00000002-0001-0000-0000-0000000000c3',
    unitId: '00000002-0001-0000-0000-0000000000f3',
  },
}

// ─── Cenário 3: Rede + clínica fisio (2 tenants distintos, mesmo group) ──
// Sprint 01b Faixa B/C — passaporte cross-tenant ATIVO entre os 2 tenants.
// Paciente "Carlos" cadastrado em ambos via patient_company_links.
const SCENARIO_3 = {
  groupId: '00000003-0001-0000-0000-000000000001',
  academiaTenantId: '00000003-0001-0000-0000-000000000010',
  clinicaTenantId: '00000003-0001-0000-0000-000000000020',
  academiaPersonId: '00000003-0001-0000-0000-0000000000a1',
  academiaCompanyId: '00000003-0001-0000-0000-0000000000c1',
  academiaUnitId: '00000003-0001-0000-0000-0000000000f1',
  clinicaPersonId: '00000003-0001-0000-0000-0000000000a2',
  clinicaCompanyId: '00000003-0001-0000-0000-0000000000c2',
  clinicaUnitId: '00000003-0001-0000-0000-0000000000f2',
  // Passaporte do paciente Carlos — Sprint 01b Faixa C ativa
  passportId: '00000003-0001-0000-0000-0000000000bb', // global passport id
  carlosAcademiaPersonId: '00000003-0001-0000-0000-0000000000ba', // persons row no tenant academia
  carlosClinicaPersonId: '00000003-0001-0000-0000-0000000000bc', // persons row no tenant clinica
  linkAcademiaId: '00000003-0001-0000-0000-0000000000bd', // patient_company_link tenant academia
  linkClinicaId: '00000003-0001-0000-0000-0000000000be', // patient_company_link tenant clinica
}

// ─── Cenário 5: Modo Solo (ADR 0069 — profissional autônomo) ──────────────
// Sprint 01b — tenants.mode='solo'. 1 matriz + 0 filiais; cross_company_access=false.
const SCENARIO_5 = {
  // group=null (autônomo NÃO está em rede)
  tenantId: '00000005-0001-0000-0000-000000000010',
  // Matriz (PF autônomo opera via PJ MEI; aceita PJ por padrão)
  matrizPersonId: '00000005-0001-0000-0000-0000000000a1',
  matrizCompanyId: '00000005-0001-0000-0000-0000000000c1',
  matrizUnitId: '00000005-0001-0000-0000-0000000000f1',
  // Profissional admin (fisio autônoma)
  adminAuthUserId: '00000005-0001-0000-0000-0000000000d1',
  adminPersonId: '00000005-0001-0000-0000-0000000000b1',
  adminUserId: '00000005-0001-0000-0000-0000000000e1',
}

// ─── Cenário 4: Mix (loja avulsa + rede no mesmo group agregado) ──────────
const SCENARIO_4 = {
  groupId: '00000004-0001-0000-0000-000000000001',
  lojaTenantId: '00000004-0001-0000-0000-000000000010',
  redeTenantId: '00000004-0001-0000-0000-000000000020',
  lojaPersonId: '00000004-0001-0000-0000-0000000000a1',
  lojaCompanyId: '00000004-0001-0000-0000-0000000000c1',
  lojaUnitId: '00000004-0001-0000-0000-0000000000f1',
  redePersonId: '00000004-0001-0000-0000-0000000000a2',
  redeCompanyId: '00000004-0001-0000-0000-0000000000c2',
  redeUnitId: '00000004-0001-0000-0000-0000000000f2',
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding ${maskUrl(DATABASE_URL)} ${KEEP ? '(keep-existing)' : '(reset)'}`)

  try {
    // Pega role tenant_owner pra atribuir aos admins
    const [tenantOwnerRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'tenant_owner'))
      .limit(1)
    if (!tenantOwnerRole) {
      throw new Error(
        'system role "tenant_owner" não encontrada. Roda `pnpm db:migrate` primeiro.',
      )
    }

    if (!KEEP) {
      console.log('  • TRUNCATE cenários canônicos (CASCADE)')
      // Ordem importa por FK (apenas no cenário onde a row existe)
      const scenarioTenants = [
        SCENARIO_1.tenantId,
        SCENARIO_2.tenantId,
        SCENARIO_3.academiaTenantId,
        SCENARIO_3.clinicaTenantId,
        SCENARIO_4.lojaTenantId,
        SCENARIO_4.redeTenantId,
        SCENARIO_5.tenantId,
      ]
      // Passaporte links (cascade pra patient_link_modules)
      await db
        .delete(patientCompanyLinks)
        .where(inArray(patientCompanyLinks.tenantId, scenarioTenants))
      await db.delete(userRoles).where(inArray(userRoles.tenantId, scenarioTenants))
      await db.delete(userTenants).where(inArray(userTenants.tenantId, scenarioTenants))
      await db.delete(users).where(inArray(users.tenantId, scenarioTenants))
      await db.delete(units).where(inArray(units.tenantId, scenarioTenants))
      await db.delete(companies).where(inArray(companies.tenantId, scenarioTenants))
      await db.delete(persons).where(inArray(persons.tenantId, scenarioTenants))
      await db.delete(tenants).where(inArray(tenants.id, scenarioTenants))
      await db
        .delete(groups)
        .where(
          inArray(groups.id, [
            SCENARIO_1.groupId,
            SCENARIO_2.groupId,
            SCENARIO_3.groupId,
            SCENARIO_4.groupId,
          ]),
        )
      await db
        .delete(authUser)
        .where(inArray(authUser.id, [SCENARIO_1.adminAuthUserId, SCENARIO_5.adminAuthUserId]))
    }

    // ─── Cenário 1: Rede própria ───────────────────────────────────────
    console.log('  • cenário 1: Rede própria (Academia Equilíbrio)')
    await seedScenario1(db, tenantOwnerRole.id)

    // ─── Cenário 2: Franquia clássica ──────────────────────────────────
    console.log('  • cenário 2: Franquia clássica (BodyTech Franquia)')
    await seedScenario2(db, tenantOwnerRole.id)

    // ─── Cenário 3: Rede + clínica (2 tenants no mesmo group) ──────────
    console.log('  • cenário 3: Rede + Clínica Fisio (2 tenants distintos)')
    await seedScenario3(db, tenantOwnerRole.id)

    // ─── Cenário 4: Mix loja+rede ──────────────────────────────────────
    console.log('  • cenário 4: Mix loja avulsa + rede no mesmo group')
    await seedScenario4(db, tenantOwnerRole.id)

    // ─── Cenário 5: Modo Solo (ADR 0069) ────────────────────────────────
    console.log('  • cenário 5: Modo Solo (Fisio Autônoma — ADR 0069)')
    await seedScenario5(db, tenantOwnerRole.id)

    console.log('✓ seed done')

    // Smoke check: contagens
    const counts = await db.execute(sql`
      SELECT 'tenants' AS k, COUNT(*)::int AS n FROM tenants
      WHERE id = ANY(ARRAY[
        ${SCENARIO_1.tenantId}::uuid, ${SCENARIO_2.tenantId}::uuid,
        ${SCENARIO_3.academiaTenantId}::uuid, ${SCENARIO_3.clinicaTenantId}::uuid,
        ${SCENARIO_4.lojaTenantId}::uuid, ${SCENARIO_4.redeTenantId}::uuid,
        ${SCENARIO_5.tenantId}::uuid
      ])
      UNION ALL
      SELECT 'companies', COUNT(*)::int FROM companies
      WHERE tenant_id = ANY(ARRAY[
        ${SCENARIO_1.tenantId}::uuid, ${SCENARIO_2.tenantId}::uuid,
        ${SCENARIO_3.academiaTenantId}::uuid, ${SCENARIO_3.clinicaTenantId}::uuid,
        ${SCENARIO_4.lojaTenantId}::uuid, ${SCENARIO_4.redeTenantId}::uuid,
        ${SCENARIO_5.tenantId}::uuid
      ])
      UNION ALL
      SELECT 'units', COUNT(*)::int FROM units
      WHERE tenant_id = ANY(ARRAY[
        ${SCENARIO_1.tenantId}::uuid, ${SCENARIO_2.tenantId}::uuid,
        ${SCENARIO_3.academiaTenantId}::uuid, ${SCENARIO_3.clinicaTenantId}::uuid,
        ${SCENARIO_4.lojaTenantId}::uuid, ${SCENARIO_4.redeTenantId}::uuid,
        ${SCENARIO_5.tenantId}::uuid
      ])
      UNION ALL
      SELECT 'users', COUNT(*)::int FROM users
      WHERE tenant_id = ANY(ARRAY[
        ${SCENARIO_1.tenantId}::uuid, ${SCENARIO_2.tenantId}::uuid,
        ${SCENARIO_3.academiaTenantId}::uuid, ${SCENARIO_3.clinicaTenantId}::uuid,
        ${SCENARIO_4.lojaTenantId}::uuid, ${SCENARIO_4.redeTenantId}::uuid,
        ${SCENARIO_5.tenantId}::uuid
      ])
    `)
    for (const row of counts.rows) {
      console.log(`    ${row.k}: ${row.n}`)
    }
  } finally {
    await pool.end()
  }
}

async function seedScenario1(db: ReturnType<typeof drizzle>, tenantOwnerRoleId: string) {
  const S = SCENARIO_1
  await db.insert(groups).values({ id: S.groupId, name: 'Grupo Equilíbrio Vital' })
  await db.insert(tenants).values({
    id: S.tenantId,
    groupId: S.groupId,
    name: 'Academia Equilíbrio',
    slug: 'academia-equilibrio',
    topology: 'owned',
    financialMode: 'centralized',
    crossCompanyAccess: true,
    subscriptionStatus: 'active',
  })
  // Matriz
  await db.insert(persons).values({
    id: S.matrizPersonId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Academia Equilíbrio LTDA',
    displayName: 'Equilíbrio Vital',
    document: '11222333000181',
  })
  await db.insert(companies).values({
    id: S.matrizCompanyId,
    tenantId: S.tenantId,
    personId: S.matrizPersonId,
    type: 'matriz',
    regimeTributario: 'simples',
  })
  await db.insert(units).values({
    id: S.matrizUnitId,
    tenantId: S.tenantId,
    companyId: S.matrizCompanyId,
    name: 'Unidade Centro',
    address: { cidade: 'São Paulo', uf: 'SP' },
  })
  // Filial Sul
  await db.insert(persons).values({
    id: S.filialSulPersonId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Equilíbrio Sul LTDA',
    document: '11222333000262',
  })
  await db.insert(companies).values({
    id: S.filialSulCompanyId,
    tenantId: S.tenantId,
    personId: S.filialSulPersonId,
    type: 'filial',
    parentCompanyId: S.matrizCompanyId,
    regimeTributario: 'simples',
  })
  await db.insert(units).values({
    id: S.filialSulUnitId,
    tenantId: S.tenantId,
    companyId: S.filialSulCompanyId,
    name: 'Unidade Sul',
    address: { cidade: 'São Paulo', uf: 'SP' },
  })
  // Filial Norte
  await db.insert(persons).values({
    id: S.filialNortePersonId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Equilíbrio Norte LTDA',
    document: '11222333000343',
  })
  await db.insert(companies).values({
    id: S.filialNorteCompanyId,
    tenantId: S.tenantId,
    personId: S.filialNortePersonId,
    type: 'filial',
    parentCompanyId: S.matrizCompanyId,
    regimeTributario: 'simples',
  })
  await db.insert(units).values({
    id: S.filialNorteUnitId,
    tenantId: S.tenantId,
    companyId: S.filialNorteCompanyId,
    name: 'Unidade Norte',
    address: { cidade: 'São Paulo', uf: 'SP' },
  })
  // Admin: auth_user + persons PF + users + user_roles
  await db.insert(authUser).values({
    id: S.adminAuthUserId,
    email: 'admin+rede@logifit.test',
    emailVerified: true,
    name: 'Admin Rede Equilíbrio',
  })
  await db.insert(persons).values({
    id: S.adminPersonId,
    tenantId: S.tenantId,
    kind: 'pf',
    name: 'Admin Rede',
    document: '11144477735',
    email: 'admin+rede@logifit.test',
  })
  await db.insert(users).values({
    id: S.adminUserId,
    tenantId: S.tenantId,
    personId: S.adminPersonId,
    authUserId: sql`${S.adminAuthUserId}::uuid`,
    username: 'admin+rede@logifit.test',
    mfaEnabled: false,
  })
  await db.insert(userTenants).values({
    userId: S.adminUserId,
    tenantId: S.tenantId,
    isDefault: true,
  })
  await db.insert(userRoles).values({
    tenantId: S.tenantId,
    userId: S.adminUserId,
    roleId: tenantOwnerRoleId,
  })
}

async function seedScenario2(db: ReturnType<typeof drizzle>, _tenantOwnerRoleId: string) {
  const S = SCENARIO_2
  await db.insert(groups).values({ id: S.groupId, name: 'Grupo BodyTech Franquia' })
  await db.insert(tenants).values({
    id: S.tenantId,
    groupId: S.groupId,
    name: 'BodyTech Franquia',
    slug: 'bodytech-franquia',
    topology: 'franchise',
    financialMode: 'distributed',
    crossCompanyAccess: true,
    subscriptionStatus: 'active',
  })
  // Franqueador (matriz)
  await db.insert(persons).values({
    id: S.franqueadorPersonId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'BodyTech Franquia Brasil SA',
    document: '52998224725'.padEnd(14, '0'),
  })
  await db.insert(companies).values({
    id: S.franqueadorCompanyId,
    tenantId: S.tenantId,
    personId: S.franqueadorPersonId,
    type: 'matriz',
  })
  await db.insert(units).values({
    id: S.franqueadorUnitId,
    tenantId: S.tenantId,
    companyId: S.franqueadorCompanyId,
    name: 'Sede Franqueador',
    address: { cidade: 'Rio de Janeiro', uf: 'RJ' },
  })
  // Franqueado A
  await db.insert(persons).values({
    id: S.franqA.personId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Franqueado A LTDA',
    document: '34028316000103',
  })
  await db.insert(companies).values({
    id: S.franqA.companyId,
    tenantId: S.tenantId,
    personId: S.franqA.personId,
    type: 'filial',
    parentCompanyId: S.franqueadorCompanyId,
  })
  await db.insert(units).values({
    id: S.franqA.unitId,
    tenantId: S.tenantId,
    companyId: S.franqA.companyId,
    name: 'Unidade Franqueado A',
    address: { cidade: 'Belo Horizonte', uf: 'MG' },
  })
  // Franqueado B
  await db.insert(persons).values({
    id: S.franqB.personId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Franqueado B LTDA',
    document: '60746948000112',
  })
  await db.insert(companies).values({
    id: S.franqB.companyId,
    tenantId: S.tenantId,
    personId: S.franqB.personId,
    type: 'filial',
    parentCompanyId: S.franqueadorCompanyId,
  })
  await db.insert(units).values({
    id: S.franqB.unitId,
    tenantId: S.tenantId,
    companyId: S.franqB.companyId,
    name: 'Unidade Franqueado B',
    address: { cidade: 'Curitiba', uf: 'PR' },
  })
}

async function seedScenario3(db: ReturnType<typeof drizzle>, _tenantOwnerRoleId: string) {
  const S = SCENARIO_3
  await db.insert(groups).values({ id: S.groupId, name: 'Grupo Movimento Saúde' })
  // Tenant 1: Academia
  await db.insert(tenants).values({
    id: S.academiaTenantId,
    groupId: S.groupId,
    name: 'Movimento Academia',
    slug: 'movimento-academia',
    topology: 'owned',
    subscriptionStatus: 'active',
  })
  await db.insert(persons).values({
    id: S.academiaPersonId,
    tenantId: S.academiaTenantId,
    kind: 'pj',
    name: 'Movimento Academia LTDA',
    document: '12345678000195',
  })
  await db.insert(companies).values({
    id: S.academiaCompanyId,
    tenantId: S.academiaTenantId,
    personId: S.academiaPersonId,
    type: 'matriz',
  })
  await db.insert(units).values({
    id: S.academiaUnitId,
    tenantId: S.academiaTenantId,
    companyId: S.academiaCompanyId,
    name: 'Academia Centro',
    address: { cidade: 'São Paulo', uf: 'SP' },
  })
  // Tenant 2: Clínica
  await db.insert(tenants).values({
    id: S.clinicaTenantId,
    groupId: S.groupId,
    name: 'Movimento Fisio',
    slug: 'movimento-fisio',
    topology: 'owned',
    subscriptionStatus: 'active',
  })
  await db.insert(persons).values({
    id: S.clinicaPersonId,
    tenantId: S.clinicaTenantId,
    kind: 'pj',
    name: 'Movimento Fisio LTDA',
    document: '00000000000191',
  })
  await db.insert(companies).values({
    id: S.clinicaCompanyId,
    tenantId: S.clinicaTenantId,
    personId: S.clinicaPersonId,
    type: 'matriz',
  })
  await db.insert(units).values({
    id: S.clinicaUnitId,
    tenantId: S.clinicaTenantId,
    companyId: S.clinicaCompanyId,
    name: 'Clínica Centro',
    address: { cidade: 'São Paulo', uf: 'SP' },
  })

  // ─── Paciente Carlos — passaporte cross-tenant (Sprint 01b Faixa B) ────
  // Mesmo CPF cadastrado em ambos tenants (persons rows distintas — RLS
  // isola); patient_company_links liga via passport_id global.
  const CARLOS_CPF = '11144477735'
  await db.insert(persons).values({
    id: S.carlosAcademiaPersonId,
    tenantId: S.academiaTenantId,
    kind: 'pf',
    name: 'Carlos Aluno',
    document: CARLOS_CPF,
    email: 'carlos@aluno.test',
  })
  await db.insert(persons).values({
    id: S.carlosClinicaPersonId,
    tenantId: S.clinicaTenantId,
    kind: 'pf',
    name: 'Carlos Paciente',
    document: CARLOS_CPF,
    email: 'carlos@aluno.test',
  })

  // Link 1: paciente Carlos ↔ tenant academia (módulo academia ativo)
  await db.insert(patientCompanyLinks).values({
    id: S.linkAcademiaId,
    passportPassportId: S.passportId,
    personId: S.carlosAcademiaPersonId,
    tenantId: S.academiaTenantId,
    status: 'active',
    creationPath: 'reactive',
    acceptedAt: new Date('2026-05-01T10:00:00Z'),
  })
  await db.insert(patientLinkModules).values({
    linkId: S.linkAcademiaId,
    passportPassportId: S.passportId,
    module: 'academia',
    status: 'active',
    dataLevels: { identidade: true, antropometria: true, treino: true, clinico: false },
    activatedAt: new Date('2026-05-01T10:00:00Z'),
  })

  // Link 2: paciente Carlos ↔ tenant clínica (módulo fisioterapia ativo)
  await db.insert(patientCompanyLinks).values({
    id: S.linkClinicaId,
    passportPassportId: S.passportId,
    personId: S.carlosClinicaPersonId,
    tenantId: S.clinicaTenantId,
    status: 'active',
    creationPath: 'reactive',
    acceptedAt: new Date('2026-05-05T14:30:00Z'),
  })
  await db.insert(patientLinkModules).values({
    linkId: S.linkClinicaId,
    passportPassportId: S.passportId,
    module: 'fisioterapia',
    status: 'active',
    dataLevels: { identidade: true, antropometria: true, treino: false, clinico: true },
    activatedAt: new Date('2026-05-05T14:30:00Z'),
  })
}

// ─── Cenário 5: Modo Solo (ADR 0069 — profissional autônomo) ────────────
async function seedScenario5(db: ReturnType<typeof drizzle>, tenantOwnerRoleId: string) {
  const S = SCENARIO_5
  // Sem groupId — autônomo NÃO está em rede
  await db.insert(tenants).values({
    id: S.tenantId,
    groupId: null,
    name: 'Dra. Mariana Silva — Fisio Autônoma',
    slug: 'dra-mariana-silva',
    mode: 'solo', // ADR 0069
    topology: 'owned',
    financialMode: 'centralized',
    crossCompanyAccess: false, // check constraint: solo NÃO pode ter true
    subscriptionStatus: 'active',
  })
  // PJ MEI (autônomo opera via MEI)
  await db.insert(persons).values({
    id: S.matrizPersonId,
    tenantId: S.tenantId,
    kind: 'pj',
    name: 'Mariana Silva — MEI ME',
    displayName: 'Dra. Mariana — Fisio',
    document: '34028316000103',
  })
  await db.insert(companies).values({
    id: S.matrizCompanyId,
    tenantId: S.tenantId,
    personId: S.matrizPersonId,
    type: 'matriz',
    regimeTributario: 'mei',
  })
  await db.insert(units).values({
    id: S.matrizUnitId,
    tenantId: S.tenantId,
    companyId: S.matrizCompanyId,
    name: 'Consultório Particular',
    address: { cidade: 'Florianópolis', uf: 'SC' },
  })
  // Profissional admin (a fisio autônoma)
  await db.insert(authUser).values({
    id: S.adminAuthUserId,
    email: 'mariana+solo@logifit.test',
    emailVerified: true,
    name: 'Dra. Mariana Silva',
  })
  await db.insert(persons).values({
    id: S.adminPersonId,
    tenantId: S.tenantId,
    kind: 'pf',
    name: 'Dra. Mariana Silva',
    document: '52998224725',
    email: 'mariana+solo@logifit.test',
  })
  await db.insert(users).values({
    id: S.adminUserId,
    tenantId: S.tenantId,
    personId: S.adminPersonId,
    authUserId: sql`${S.adminAuthUserId}::uuid`,
    username: 'mariana+solo@logifit.test',
    mfaEnabled: false,
  })
  await db.insert(userTenants).values({
    userId: S.adminUserId,
    tenantId: S.tenantId,
    isDefault: true,
  })
  // Solo NÃO ganha tenant_owner — ganha role 'fisio' (regra 43 — requires_mfa)
  await db.insert(userRoles).values({
    tenantId: S.tenantId,
    userId: S.adminUserId,
    roleId: tenantOwnerRoleId, // tenant_owner sempre (dono do solo é dono administrativo)
  })
}

async function seedScenario4(db: ReturnType<typeof drizzle>, _tenantOwnerRoleId: string) {
  const S = SCENARIO_4
  await db.insert(groups).values({ id: S.groupId, name: 'Grupo Mix Investimentos' })
  // Tenant 1: Loja avulsa (sem topology franquia)
  await db.insert(tenants).values({
    id: S.lojaTenantId,
    groupId: S.groupId,
    name: 'Loja Avulsa Bem-Estar',
    slug: 'loja-bem-estar',
    topology: 'owned',
    subscriptionStatus: 'active',
  })
  await db.insert(persons).values({
    id: S.lojaPersonId,
    tenantId: S.lojaTenantId,
    kind: 'pj',
    name: 'Bem-Estar Loja Avulsa LTDA',
    document: '11222333000424',
  })
  await db.insert(companies).values({
    id: S.lojaCompanyId,
    tenantId: S.lojaTenantId,
    personId: S.lojaPersonId,
    type: 'matriz',
  })
  await db.insert(units).values({
    id: S.lojaUnitId,
    tenantId: S.lojaTenantId,
    companyId: S.lojaCompanyId,
    name: 'Loja Única',
    address: { cidade: 'Florianópolis', uf: 'SC' },
  })
  // Tenant 2: Rede pequena
  await db.insert(tenants).values({
    id: S.redeTenantId,
    groupId: S.groupId,
    name: 'Rede Multiunidades',
    slug: 'rede-multiunidades',
    topology: 'owned',
    subscriptionStatus: 'active',
  })
  await db.insert(persons).values({
    id: S.redePersonId,
    tenantId: S.redeTenantId,
    kind: 'pj',
    name: 'Multi Bem-Estar SA',
    document: '11222333000505',
  })
  await db.insert(companies).values({
    id: S.redeCompanyId,
    tenantId: S.redeTenantId,
    personId: S.redePersonId,
    type: 'matriz',
  })
  await db.insert(units).values({
    id: S.redeUnitId,
    tenantId: S.redeTenantId,
    companyId: S.redeCompanyId,
    name: 'Rede Multi - Sede',
    address: { cidade: 'Porto Alegre', uf: 'RS' },
  })
}

function maskUrl(url: string): string {
  return url.replace(/:[^:@]+@/, ':***@')
}

main().catch((err) => {
  console.error('seed error:', err)
  process.exit(1)
})

export const SCENARIOS = {
  rede: SCENARIO_1,
  franquia: SCENARIO_2,
  redeMaisClinica: SCENARIO_3,
  mix: SCENARIO_4,
  solo: SCENARIO_5,
}
