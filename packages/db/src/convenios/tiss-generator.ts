/**
 * Gerador XML TISS 4.01 — Sprint 22 Faixa B.1 (ADR 0029 esperado).
 *
 * MVP: estrutura compatível com ANS TISS 4.01 (Ofício-Circular 1/2026) sem
 * dependência de biblioteca XSD externa. Validação proativa em `tiss-validator.ts`
 * cobre regras de negócio antes do envio.
 *
 * **Sprint 22b** integra XSD oficial da ANS via `xmllint` Node binding ou
 * `libxmljs` para validação contra schema; também adiciona digital signature
 * (XMLDSig) quando exigido pela operadora.
 *
 * Função pura — não toca DB; caller carrega rows e passa.
 */

// ─── Tipos canônicos ────────────────────────────────────────────────────

export type GuideKind = 'consulta' | 'sp_sadt'

export interface ProfessionalSnapshot {
  /** Nome completo do profissional */
  name: string
  /** Sigla do conselho — CRM/CREFITO/CRN/CREF/COREN */
  councilBody: string
  councilState: string
  councilNumber: string
  /** CBOS — Classificação Brasileira de Ocupações Saúde */
  cbosCode: string
}

export interface MemberInsuranceSnapshot {
  cardNumber: string
  memberName: string
  /** Validade carteirinha */
  validUntil?: string | null // YYYY-MM-DD
  /** Categoria (apartamento/enfermaria/etc) */
  category?: string | null
}

export interface OperatorSnapshot {
  ansCode: string
  name: string
}

export interface PrestadorSnapshot {
  cnpj: string
  name: string
  /** Código no plano (matrícula prestador) */
  codePlan?: string | null
}

export interface GuideItem {
  sequenceNumber: number
  /** Código TUSS */
  tussCode: string
  description: string
  quantity: number
  unitPriceCents: number
  totalCents: number
  /** Data de execução do procedimento — YYYY-MM-DD */
  executionDate: string
  /** Profissional executante */
  professional: ProfessionalSnapshot
}

export interface GuideInput {
  /** Versão TISS — sempre '4.01' no MVP */
  tissVersion: '4.01'
  kind: GuideKind
  /** Número da guia no prestador */
  guideNumber: string
  /** Número da guia atribuído pela operadora (opcional na geração inicial) */
  operatorGuideNumber?: string | null
  /** Senha/número de autorização */
  authorizationNumber?: string | null
  operator: OperatorSnapshot
  prestador: PrestadorSnapshot
  memberInsurance: MemberInsuranceSnapshot
  items: GuideItem[]
  /** Total da guia em centavos */
  totalCents: number
  /** Data de emissão da guia — YYYY-MM-DD */
  issueDate: string
}

// ─── Geradores XML ──────────────────────────────────────────────────────

/**
 * Escape XML básico — &, <, >, ", '
 */
function escapeXml(s: string | null | undefined): string {
  if (s == null) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function centsToBrl(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * Gera XML TISS 4.01 para uma guia única (consulta ou SP/SADT).
 *
 * Note: simplificação do schema oficial — incluímos os campos essenciais.
 * Sprint 22b expande com namespace ANS completo + todos os elementos opcionais.
 */
export function generateGuideXml(input: GuideInput): string {
  const guideTag = input.kind === 'consulta' ? 'guiaConsulta' : 'guiaSPSADT'
  const items = input.items
    .map(
      (it) => `
      <procedimentoExecutado>
        <sequencialItem>${it.sequenceNumber}</sequencialItem>
        <dataExecucao>${escapeXml(it.executionDate)}</dataExecucao>
        <procedimento>
          <codigoTabela>22</codigoTabela>
          <codigoProcedimento>${escapeXml(it.tussCode)}</codigoProcedimento>
          <descricaoProcedimento>${escapeXml(it.description)}</descricaoProcedimento>
        </procedimento>
        <quantidadeExecutada>${it.quantity}</quantidadeExecutada>
        <valorUnitario>${centsToBrl(it.unitPriceCents)}</valorUnitario>
        <valorTotal>${centsToBrl(it.totalCents)}</valorTotal>
        <equipeExecutora>
          <grauParticipacao>00</grauParticipacao>
          <codigoProfissional>${escapeXml(it.professional.councilNumber)}</codigoProfissional>
          <nomeProfissional>${escapeXml(it.professional.name)}</nomeProfissional>
          <conselhoProfissional>
            <siglaConselho>${escapeXml(it.professional.councilBody)}</siglaConselho>
            <numeroConselhoProfissional>${escapeXml(it.professional.councilNumber)}</numeroConselhoProfissional>
            <UF>${escapeXml(it.professional.councilState)}</UF>
          </conselhoProfissional>
          <CBOS>${escapeXml(it.professional.cbosCode)}</CBOS>
        </equipeExecutora>
      </procedimentoExecutado>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versaoTISS="${input.tissVersion}">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_GUIA</ans:tipoTransacao>
      <ans:sequencialTransacao>${escapeXml(input.guideNumber)}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${escapeXml(input.issueDate)}</ans:dataRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem>
      <ans:identificacaoPrestador>
        <ans:CNPJ>${escapeXml(input.prestador.cnpj)}</ans:CNPJ>
        ${input.prestador.codePlan ? `<ans:codigoPrestadorNaOperadora>${escapeXml(input.prestador.codePlan)}</ans:codigoPrestadorNaOperadora>` : ''}
      </ans:identificacaoPrestador>
    </ans:origem>
    <ans:destino>
      <ans:registroANS>${escapeXml(input.operator.ansCode)}</ans:registroANS>
    </ans:destino>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:${guideTag}>
      <ans:cabecalhoGuia>
        <ans:registroANS>${escapeXml(input.operator.ansCode)}</ans:registroANS>
        <ans:numeroGuiaPrestador>${escapeXml(input.guideNumber)}</ans:numeroGuiaPrestador>
        ${input.operatorGuideNumber ? `<ans:numeroGuiaOperadora>${escapeXml(input.operatorGuideNumber)}</ans:numeroGuiaOperadora>` : ''}
      </ans:cabecalhoGuia>
      <ans:dadosBeneficiario>
        <ans:numeroCarteira>${escapeXml(input.memberInsurance.cardNumber)}</ans:numeroCarteira>
        <ans:nomeBeneficiario>${escapeXml(input.memberInsurance.memberName)}</ans:nomeBeneficiario>
        ${input.memberInsurance.validUntil ? `<ans:validadeCarteira>${escapeXml(input.memberInsurance.validUntil)}</ans:validadeCarteira>` : ''}
      </ans:dadosBeneficiario>
      ${input.authorizationNumber ? `<ans:numeroAutorizacao>${escapeXml(input.authorizationNumber)}</ans:numeroAutorizacao>` : ''}
      <ans:procedimentosExecutados>${items}
      </ans:procedimentosExecutados>
      <ans:valorTotal>
        <ans:valorTotalGeral>${centsToBrl(input.totalCents)}</ans:valorTotalGeral>
      </ans:valorTotal>
    </ans:${guideTag}>
  </ans:prestadorParaOperadora>
</ans:mensagemTISS>`
}

// ─── Gerador de lote ────────────────────────────────────────────────────

export interface BatchInput {
  tissVersion: '4.01'
  batchNumber: string
  /** XMLs já gerados das guias do lote */
  guides: Array<{ kind: GuideKind; xml: string }>
  operator: OperatorSnapshot
  prestador: PrestadorSnapshot
  /** YYYY-MM-DD */
  issueDate: string
}

/**
 * Gera XML de lote envelopando guias individuais. Cada guia já vem gerada
 * via `generateGuideXml` (caller agrega).
 */
export function generateBatchXml(input: BatchInput): string {
  // Extrai o conteúdo `<prestadorParaOperadora>` de cada guia individual e
  // agrega no lote. Para MVP, usa concatenação string; Sprint 22b pode usar
  // DOM parsing.
  const guidesContent = input.guides
    .map((g) => {
      // Extrai bloco entre as tags <ans:prestadorParaOperadora>...</ans:prestadorParaOperadora>
      const match = g.xml.match(
        /<ans:prestadorParaOperadora>([\s\S]*?)<\/ans:prestadorParaOperadora>/,
      )
      return match ? match[1]!.trim() : ''
    })
    .filter(Boolean)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<ans:mensagemTISS xmlns:ans="http://www.ans.gov.br/padroes/tiss/schemas" versaoTISS="${input.tissVersion}">
  <ans:cabecalho>
    <ans:identificacaoTransacao>
      <ans:tipoTransacao>ENVIO_LOTE_GUIAS</ans:tipoTransacao>
      <ans:sequencialTransacao>${escapeXml(input.batchNumber)}</ans:sequencialTransacao>
      <ans:dataRegistroTransacao>${escapeXml(input.issueDate)}</ans:dataRegistroTransacao>
    </ans:identificacaoTransacao>
    <ans:origem>
      <ans:identificacaoPrestador>
        <ans:CNPJ>${escapeXml(input.prestador.cnpj)}</ans:CNPJ>
      </ans:identificacaoPrestador>
    </ans:origem>
    <ans:destino>
      <ans:registroANS>${escapeXml(input.operator.ansCode)}</ans:registroANS>
    </ans:destino>
  </ans:cabecalho>
  <ans:prestadorParaOperadora>
    <ans:loteGuias>
      <ans:numeroLote>${escapeXml(input.batchNumber)}</ans:numeroLote>
      <ans:guiasTISS>
${guidesContent}
      </ans:guiasTISS>
    </ans:loteGuias>
  </ans:prestadorParaOperadora>
</ans:mensagemTISS>`
}
