/**
 * Seed Sprint 20 Faixa D — Fisio prontuário.
 *
 * Idempotente. Popula:
 *   - signature_policies: medico/fisio/nutri/personal/enfermeiro (ADR 0032)
 *   - cid_catalog: ~50 CID-11 top fisio/clínica/personal (ADR 0028)
 *   - cif_catalog: ~30 CIF top fisio (ADR 0028)
 *
 * Uso: `pnpm --filter @repo/db db:seed:fisio`
 */
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { cidCatalog, cifCatalog, signaturePolicies } from '../src/schema/index.js'

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/logifit'

interface PolicySeed {
  profession: string
  mode: 'icp_required' | 'icp_optional' | 'authenticated_lock'
  minCertLevel: 'A1' | 'A3' | null
  requiresMfa: boolean
  requiresAuditChain: boolean
  requiresAuthenticatedSession: boolean
  sourceNorm: string
  retentionYears: number
  notes: string
}

const POLICIES: PolicySeed[] = [
  {
    profession: 'medico',
    mode: 'icp_required',
    minCertLevel: 'A3',
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'CFM 2.299/2021 + Lei 13.787/2018',
    retentionYears: 20,
    notes: 'ICP-Brasil A3 obrigatório (token criptográfico ou cartão).',
  },
  {
    profession: 'fisio',
    mode: 'authenticated_lock',
    minCertLevel: null,
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'COFFITO 414/2012 + 415/2012 + Lei 13.787/2018',
    retentionYears: 20,
    notes:
      'ICP-Brasil opcional se houver autenticação + audit chain (regra 39) + hash SHA-256 conteúdo.',
  },
  {
    profession: 'nutri',
    mode: 'authenticated_lock',
    minCertLevel: null,
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'CFN 599/2018 + Lei 13.787/2018',
    retentionYears: 20,
    notes: 'Similar a COFFITO — autenticação + trilha equivalente.',
  },
  {
    profession: 'personal',
    mode: 'authenticated_lock',
    minCertLevel: null,
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'Lei 9.696/1998 + diretrizes CONFEF',
    retentionYears: 20,
    notes: 'Atividade não-clínica majoritária. Lacre suficiente.',
  },
  {
    profession: 'enfermeiro',
    mode: 'icp_optional',
    minCertLevel: 'A1',
    requiresMfa: true,
    requiresAuditChain: true,
    requiresAuthenticatedSession: true,
    sourceNorm: 'COFEN 358/2009',
    retentionYears: 20,
    notes: 'Fase 3 — Sprint não-ativo no MVP.',
  },
]

interface CidSeed {
  code: string
  description: string
  chapter: string
}

const CIDS: CidSeed[] = [
  // Musculoesqueléticos (MG)
  { code: 'MG30.0', description: 'Dor lombar baixa não específica', chapter: 'MG' },
  { code: 'MG30.1', description: 'Dor lombar com sintomas radiculares', chapter: 'MG' },
  { code: 'MG30.50', description: 'Dor cervical inespecífica', chapter: 'MG' },
  { code: 'FB52', description: 'Tendinopatia do manguito rotador', chapter: 'FB' },
  { code: 'FB54.0', description: 'Síndrome do túnel do carpo', chapter: 'FB' },
  { code: 'FB55.0', description: 'Tendinopatia patelar', chapter: 'FB' },
  { code: 'FB55.1', description: 'Síndrome femoropatelar', chapter: 'FB' },
  { code: 'FB56', description: 'Fasciíte plantar', chapter: 'FB' },
  { code: 'FB30.0', description: 'Bursite trocantérica do quadril', chapter: 'FB' },
  { code: 'FB30.1', description: 'Bursite subacromial', chapter: 'FB' },
  { code: 'FB45.0', description: 'Capsulite adesiva do ombro', chapter: 'FB' },
  { code: 'FB80', description: 'Condromalácia da patela', chapter: 'FB' },
  { code: 'BA00', description: 'Lesão LCA do joelho', chapter: 'BA' },
  { code: 'BA01', description: 'Lesão meniscal', chapter: 'BA' },
  // Reumatológicos (FA)
  { code: 'FA20', description: 'Artrite reumatoide', chapter: 'FA' },
  { code: 'FA00', description: 'Osteoartrose primária', chapter: 'FA' },
  { code: 'FA20.1', description: 'Espondilite anquilosante', chapter: 'FA' },
  { code: 'MG30.51', description: 'Fibromialgia', chapter: 'MG' },
  { code: 'FA25', description: 'Gota crônica', chapter: 'FA' },
  // Neurológicos (8B)
  { code: '8B11', description: 'Hemiplegia pós-AVC', chapter: '8B' },
  { code: '8B20', description: 'Paraplegia traumática', chapter: '8B' },
  { code: '8B25', description: 'Tetraplegia traumática', chapter: '8B' },
  { code: '8A40', description: 'Esclerose múltipla', chapter: '8A' },
  { code: '8A00', description: 'Doença de Parkinson', chapter: '8A' },
  { code: '8B81', description: 'Mielopatia cervical', chapter: '8B' },
  // Respiratórios (CA)
  { code: 'CA23', description: 'Asma persistente moderada', chapter: 'CA' },
  { code: 'CA22', description: 'DPOC estágio II/III', chapter: 'CA' },
  { code: 'CA40', description: 'Pneumonia adquirida na comunidade (sequela)', chapter: 'CA' },
  // Endócrinos (5A/5B)
  { code: '5A11', description: 'Diabetes mellitus tipo 2', chapter: '5A' },
  { code: '5B81', description: 'Obesidade grau I (IMC 30-34.9)', chapter: '5B' },
  { code: '5B82', description: 'Obesidade grau II (IMC 35-39.9)', chapter: '5B' },
  { code: '5B83', description: 'Obesidade grau III (IMC ≥ 40)', chapter: '5B' },
  { code: '5C80', description: 'Síndrome metabólica', chapter: '5C' },
  { code: '5C81', description: 'Dislipidemia', chapter: '5C' },
  // Z — promoção saúde
  { code: 'QA10', description: 'Avaliação física pré-treino', chapter: 'QA' },
  { code: 'QA11', description: 'Consulta para promoção da saúde', chapter: 'QA' },
  { code: 'QA12', description: 'Retorno pós-cirurgia ortopédica (fisio)', chapter: 'QA' },
  { code: 'QA13', description: 'Acompanhamento nutricional preventivo', chapter: 'QA' },
  { code: 'QA14', description: 'Reabilitação após acidente vascular', chapter: 'QA' },
  { code: 'QA15', description: 'Manutenção/condicionamento atlético', chapter: 'QA' },
  // Vasculares (BD)
  { code: 'BD93.0', description: 'Insuficiência venosa crônica MMII', chapter: 'BD' },
  { code: 'BD93.1', description: 'Linfedema MMII pós-cirúrgico', chapter: 'BD' },
  // Pediátricos
  { code: 'LD24', description: 'Atraso desenvolvimento motor', chapter: 'LD' },
  { code: 'LD25', description: 'Paralisia cerebral espástica', chapter: 'LD' },
  // Mulher/idoso
  { code: 'MG31.5', description: 'Dor pélvica crônica', chapter: 'MG' },
  { code: 'FB54.5', description: 'Síndrome dolorosa miofascial', chapter: 'FB' },
  // Pós-operatório
  { code: 'QC50', description: 'Reabilitação pós-artroplastia de joelho', chapter: 'QC' },
  { code: 'QC51', description: 'Reabilitação pós-artroplastia de quadril', chapter: 'QC' },
  { code: 'QC60', description: 'Reabilitação pós-acromioplastia', chapter: 'QC' },
  // Dor crônica
  { code: 'MG31.0', description: 'Dor crônica primária', chapter: 'MG' },
  { code: 'MG31.4', description: 'Dor crônica secundária a câncer', chapter: 'MG' },
]

interface CifSeed {
  code: string
  description: string
  component:
    | 'body_functions'
    | 'body_structures'
    | 'activities_participation'
    | 'environmental_factors'
}

const CIFS: CifSeed[] = [
  // Funções (b)
  { code: 'b280', description: 'Sensação de dor', component: 'body_functions' },
  {
    code: 'b710',
    description: 'Funções da mobilidade das articulações',
    component: 'body_functions',
  },
  { code: 'b730', description: 'Funções da força muscular', component: 'body_functions' },
  { code: 'b735', description: 'Funções do tônus muscular', component: 'body_functions' },
  { code: 'b740', description: 'Funções da resistência muscular', component: 'body_functions' },
  {
    code: 'b760',
    description: 'Funções do controle de movimento voluntário',
    component: 'body_functions',
  },
  { code: 'b770', description: 'Funções da marcha', component: 'body_functions' },
  { code: 'b430', description: 'Funções do sistema hematológico', component: 'body_functions' },
  { code: 'b455', description: 'Funções da tolerância ao exercício', component: 'body_functions' },
  { code: 'b440', description: 'Funções da respiração', component: 'body_functions' },
  // Estruturas (s)
  { code: 's750', description: 'Estrutura do membro inferior', component: 'body_structures' },
  { code: 's730', description: 'Estrutura do membro superior', component: 'body_structures' },
  { code: 's760', description: 'Estrutura do tronco', component: 'body_structures' },
  {
    code: 's120',
    description: 'Medula espinhal e estruturas relacionadas',
    component: 'body_structures',
  },
  {
    code: 's410',
    description: 'Estrutura do sistema cardiovascular',
    component: 'body_structures',
  },
  // Atividades/Participação (d)
  { code: 'd450', description: 'Andar', component: 'activities_participation' },
  { code: 'd455', description: 'Deslocar-se', component: 'activities_participation' },
  { code: 'd540', description: 'Vestir-se', component: 'activities_participation' },
  { code: 'd550', description: 'Comer', component: 'activities_participation' },
  {
    code: 'd610',
    description: 'Aquisição de bens e serviços',
    component: 'activities_participation',
  },
  {
    code: 'd640',
    description: 'Realizar trabalho doméstico',
    component: 'activities_participation',
  },
  { code: 'd850', description: 'Trabalho remunerado', component: 'activities_participation' },
  { code: 'd910', description: 'Vida comunitária', component: 'activities_participation' },
  { code: 'd920', description: 'Recreação e lazer', component: 'activities_participation' },
  // Fatores ambientais (e)
  { code: 'e310', description: 'Família próxima', component: 'environmental_factors' },
  { code: 'e320', description: 'Amigos', component: 'environmental_factors' },
  { code: 'e355', description: 'Profissionais de saúde', component: 'environmental_factors' },
  {
    code: 'e398',
    description: 'Outros relacionamentos próximos',
    component: 'environmental_factors',
  },
  {
    code: 'e150',
    description: 'Design dos edifícios para uso público',
    component: 'environmental_factors',
  },
  {
    code: 'e155',
    description: 'Design dos edifícios para uso privado',
    component: 'environmental_factors',
  },
]

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL })
  const db = drizzle(pool)
  console.log(`→ seeding fisio ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`)

  // signature_policies — ON CONFLICT (profession) DO UPDATE pra refletir mudanças
  let policiesInserted = 0
  for (const p of POLICIES) {
    try {
      await db.insert(signaturePolicies).values(p).onConflictDoNothing()
      policiesInserted += 1
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code !== '23505') throw err
    }
  }

  let cidsInserted = 0
  for (const c of CIDS) {
    try {
      await db.insert(cidCatalog).values(c).onConflictDoNothing()
      cidsInserted += 1
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code !== '23505') throw err
    }
  }

  let cifsInserted = 0
  for (const c of CIFS) {
    try {
      await db.insert(cifCatalog).values(c).onConflictDoNothing()
      cifsInserted += 1
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } }
      const code = e.code ?? e.cause?.code ?? ''
      if (code !== '23505') throw err
    }
  }

  console.log(
    `✓ seed done: ${policiesInserted}/${POLICIES.length} policies + ${cidsInserted}/${CIDS.length} CIDs + ${cifsInserted}/${CIFS.length} CIFs`,
  )
  await pool.end()
}

main().catch((err) => {
  console.error('seed failed:', err)
  process.exit(1)
})
