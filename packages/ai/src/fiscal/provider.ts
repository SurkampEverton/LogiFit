/**
 * Fiscal provider abstrato — Sprint 36 Faixa B.1 (ADR 0059 + ADR 0076).
 *
 * Interface comum pra adapters fiscais. MVP entrega `MockFiscalProvider`
 * (dev/test); Sprint 36b traz `FocusNfeProvider` real com `safeFetch()`
 * (regra 37 + ADR 0073) + allowlist `focusnfe.com.br`.
 *
 * **Provider plug-in** preparado pra Sprint 36c trazer `NfseNacionalProvider`
 * (ADR 0076) — apenas adapter novo, sem mudar `fiscal_emissions.provider`.
 *
 * **Não-objetivos:**
 *   - Provider NUNCA calcula imposto — Focus/Nfse Nacional fazem CST/CFOP/ICMS/PIS
 *     etc no servidor deles. LogiFit apenas envia payload semântico (operação,
 *     valor, tomador, serviço, UF) + provider devolve XML + chave.
 *   - Provider NUNCA assina certificado A1 localmente no MVP — usa infra do
 *     provider. Sprint 36c stretch: opção "cert próprio" via Sprint 17 PFX.
 */

export type FiscalProviderName = 'focus_nfe' | 'mock' | 'nfse_nacional' | 'enotas'

export type FiscalProviderEnv = 'homologacao' | 'producao'

/**
 * 8 tipos de emissão suportados (espelha enum `fiscal_emission_kind` no schema).
 */
export type FiscalEmissionKind =
  | 'nfse'
  | 'nfe'
  | 'nfce'
  | 'nfe_return'
  | 'nfe_transfer'
  | 'nfe_conserto_out'
  | 'nfe_conserto_return'
  | 'nfe_self_entry'

/**
 * Payload semântico pra emitir NFS-e (serviço). Provider monta XML específico
 * do município (Brasil tem 5500+ layouts NFS-e distintos — ABRASF, GINFES,
 * IPM, Nota Carioca, etc — Focus normaliza tudo).
 */
export interface NfseEmissionInput {
  /** Empresa emitente (matriz ou filial) */
  companyCnpj: string
  /** Código IBGE 7 dígitos do município onde serviço é prestado */
  municipalityCode: string
  serie: number
  numero: number
  /** Tomador (PF ou PJ) */
  recipient: {
    document: string // CPF (11) ou CNPJ (14) sem formatação
    name: string
    email?: string | null
    address?: {
      street: string
      number: string
      complement?: string | null
      district: string
      municipalityCode: string
      uf: string
      zip: string
    }
  }
  service: {
    /** Item LC 116/2003 — formato "X.YY" */
    lc116Code: string | null
    /**
     * Código de Tributação Nacional (CGNFS-e) — 6 dígitos
     * item(2)+subitem(2)+desdobramento(2), ex. `010601`.
     *
     * Municípios já migrados ao padrão nacional exigem este; o formato da LC
     * 116 é recusado ("não possui desdobramento nacional"). Quando presente,
     * tem precedência sobre `lc116Code` no payload.
     */
    codigoTributacaoNacional?: string | null
    /** CNAE da empresa que presta */
    cnae?: string | null
    description: string
    /** Valor bruto em centavos (provider faz cálculo de ISS/PIS/COFINS) */
    valorTotalCents: number
    /** Alíquota ISS em basis points (200 = 2.00%) */
    issRateBp: number
    /**
     * Regime tributário do prestador.
     *
     * Determina `optante_simples_nacional` na raiz do payload — campo
     * obrigatório da Focus que o LogiFit nunca enviou. Omitir faz o município
     * tratar a nota como regime normal e lançar ISS próprio sobre faturamento
     * que já recolhe ISS dentro do DAS (LC 123/2006 art. 13, VIII): imposto em
     * duplicidade, revertível só por repetição de indébito.
     *
     * MEI conta como optante — SIMEI é sub-regime do Simples.
     */
    taxRegime: 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei'
  }
  /** Notas adicionais do operador (opcional) */
  notes?: string | null
  /** Inscrição municipal do prestador (municípios que exigem) */
  inscricaoMunicipal?: string | null
  /** ISS retido na fonte pelo tomador (retenção do catálogo fiscal) */
  issRetido?: boolean
}

export interface NfeProductEmissionInput {
  companyCnpj: string
  serie: number
  numero: number
  recipient: {
    document: string
    name: string
    address?: {
      street: string
      number: string
      complement?: string | null
      district: string
      municipalityCode: string
      uf: string
      zip: string
    }
  }
  items: Array<{
    sku: string
    description: string
    quantity: number
    unitCents: number
    cfop: string // 4 dígitos (5102, 6102, etc) — calculado pelo cfopResolver
    ncm: string // 8 dígitos
    cestCode?: string | null
  }>
  /** finNFe: 1=normal, 2=complementar, 3=ajuste, 4=devolução */
  finNFe: 1 | 2 | 3 | 4
  /** idDest: 1=interna, 2=interestadual, 3=exterior */
  idDest: 1 | 2 | 3
}

/**
 * Opções da emissão modelo 55 — o que distingue venda de devolução,
 * transferência, conserto e entrada própria (ADR 0059).
 *
 * Vive na interface (não só no adapter Focus) porque é decisão fiscal do
 * caller, não detalhe de provider: `nfe_return` exige `referencedChaves`
 * (refNFe da nota original) e `finNFe=4`; entrada própria exige
 * `tipoDocumento=0`.
 */
export interface NfeProductEmissionOptions {
  /** Kind real da emissão — roteia o `ref` e o recurso do provider */
  kind?: FiscalEmissionKind
  /** Descrição da operação ("Venda de mercadoria", "Devolução de compra"…) */
  naturezaOperacao?: string
  /** 1=saída (venda/devolução/transferência), 0=entrada (compra de PF) */
  tipoDocumento?: 0 | 1
  /** Chaves SEFAZ referenciadas — devolução exige a da nota original */
  referencedChaves?: string[]
  /** Data de emissão (default: agora) */
  emissionDate?: Date
  /** presenca_comprador SEFAZ (default 9 = não presencial) */
  presencaComprador?: number
}

/**
 * Payload semântico NFC-e (modelo 65, varejo balcão). Difere de NF-e:
 * destinatário opcional (venda sem identificação) e formas de pagamento
 * obrigatórias no XML (grupo pag do modelo 65).
 */
export interface NfceEmissionInput {
  companyCnpj: string
  serie: number
  numero: number
  /** CPF do consumidor (opcional — venda sem identificação é permitida) */
  recipientCpf?: string | null
  items: Array<{
    sku: string
    description: string
    quantity: number
    unitCents: number
    cfop: string
    ncm: string
    cestCode?: string | null
  }>
  /**
   * Formas de pagamento (grupo obrigatório no modelo 65).
   * Código conforme tabela SEFAZ: 01=dinheiro, 03=crédito, 04=débito, 17=PIX.
   */
  payments: Array<{
    method:
      | '01'
      | '02'
      | '03'
      | '04'
      | '05'
      | '10'
      | '11'
      | '12'
      | '13'
      | '15'
      | '16'
      | '17'
      | '18'
      | '19'
      | '90'
      | '99'
    amountCents: number
  }>
}

export interface EmissionResult {
  /** Identificador do provider (Focus: `ref`) pra correlacionar webhook */
  providerRef: string
  /** Status inicial — `queued` ou `completed` (síncrono) */
  status: 'queued' | 'processing' | 'completed' | 'rejected'
  /** Chave SEFAZ 44 dígitos (NF-e/NFC-e) ou protocolo municipal (NFS-e); NULL se queued */
  chave: string | null
  /** Quando síncrono, URLs assinadas pra XML + PDF (TTL provider-side) */
  xmlUrl?: string | null
  pdfUrl?: string | null
  /** Quando rejected, mensagem do SEFAZ */
  rejectionReason?: string | null
  /**
   * Numero e serie do DOCUMENTO, atribuidos pela autoridade — distintos da
   * serie/numero do RPS que nos geramos.
   *
   * Nao sao a mesma coisa e confundi-los quebra a conciliacao: a primeira
   * NFS-e real saiu como serie 1 numero 12 em Cascavel enquanto o RPS era
   * serie 13 numero 6, e a tela exibia o RPS como se fosse a nota. Quem
   * procurasse a nota 6 no portal do municipio nao acharia nada.
   */
  documentNumber?: string | null
  documentSerie?: string | null
  /** Raw response pra dump em `fiscal_emissions.payload` (audit) */
  raw: Record<string, unknown>
  /**
   * Corpo JSON efetivamente transmitido ao provider.
   *
   * Sem isto, depurar rejeicao fiscal e adivinhacao: o motivo devolvido pelo
   * municipio ("codigo do item da lista de servico preenchido incorretamente")
   * so faz sentido ao lado do valor que foi enviado. Documento fiscal e
   * retido 5 anos (regra 34) — o que saiu daqui faz parte do dossie.
   *
   * Nao carrega credencial: a autenticacao da Focus vai no header Basic,
   * fora do corpo.
   */
  sentPayload?: Record<string, unknown>
}

export interface CancellationInput {
  /** Identificador da emission no provider (ref) */
  providerRef: string
  /** Chave SEFAZ obrigatória pra cancelamento */
  chave: string
  /** Motivo (15-255 chars) */
  justification: string
  /**
   * Tipo da emissão original — providers com endpoint por recurso (Focus:
   * DELETE /v2/{nfse|nfe|nfce}/{ref}) precisam saber onde cancelar.
   */
  kind: FiscalEmissionKind
}

export interface CceInput {
  providerRef: string
  chave: string
  /** Texto da correção (15-1000 chars) */
  correction: string
  /** Número sequencial do evento (1-30) */
  sequence: number
}

export interface InutilizacaoInput {
  companyCnpj: string
  emissionKind: FiscalEmissionKind
  serie: number
  numeroFrom: number
  numeroTo: number
  justification: string
  /** Ano da inutilização (2 dígitos) */
  year: number
}

export interface EventResult {
  providerRef: string
  status: 'queued' | 'processing' | 'completed' | 'rejected'
  xmlUrl?: string | null
  rejectionReason?: string | null
  raw: Record<string, unknown>
}

export interface ProviderHealthResult {
  ok: boolean
  /** Latency da call de health (ms) */
  latencyMs: number
  /** Mensagem detalhada do erro (quando ok=false) */
  message: string | null
}

/**
 * Interface canônica que todo adapter implementa. Server Action chama via
 * `resolveFiscalProvider(tenantId)` que retorna instância configurada.
 */
export interface FiscalProvider {
  readonly name: FiscalProviderName
  readonly env: FiscalProviderEnv

  /** Validar credentials + retornar latency de chamada simples */
  healthCheck(): Promise<ProviderHealthResult>

  /** Emissão NFS-e (serviço municipal) */
  emitNfse(input: NfseEmissionInput): Promise<EmissionResult>

  /** Emissão NF-e produto (modelo 55) — cobre venda, devolução (finNFe=4), transferência, conserto e entrada própria via CFOP/natureza + options */
  emitNfeProduct(
    input: NfeProductEmissionInput,
    options?: NfeProductEmissionOptions,
  ): Promise<EmissionResult>

  /** Emissão NFC-e (modelo 65, varejo balcão) */
  emitNfce(input: NfceEmissionInput): Promise<EmissionResult>

  /** Cancelamento dentro da janela permitida */
  cancel(input: CancellationInput): Promise<EventResult>

  /** Carta de Correção Eletrônica (NF-e modelo 55) */
  issueCce(input: CceInput): Promise<EventResult>

  /** Inutilização de faixa de numeração pulada */
  inutilize(input: InutilizacaoInput): Promise<EventResult>

  /**
   * Re-consulta status de emissão por providerRef. `kind` roteia o endpoint
   * de consulta em providers com recurso por tipo (Focus: GET /v2/{recurso}/{ref}).
   */
  queryStatus(providerRef: string, kind: FiscalEmissionKind): Promise<EmissionResult>
}
