/**
 * Memorial PDF — Sprint 37b (substitui stub Sprint 37a).
 *
 * Render server-side via @react-pdf/renderer (dependency Sprint 37b). Não vai
 * pro client bundle — `exportMemorialPdf` Server Action chama renderToBuffer
 * e retorna base64 + filename sugerido.
 *
 * **Layout** (A4 retrato):
 *   - Cabeçalho com nome LogiFit + filial + competência
 *   - 3 KPI inline: Receita / Imposto / Alíquota
 *   - Tabela de breakdown por kind (NFS-e/NF-e/NFC-e/etc)
 *   - Memorial completo (linha-a-linha com step + label + formula + valor)
 *   - Rodapé com texto legal — "apuração operacional, valide com contador"
 *
 * Sprint 37c+: branding tenant (logo + cor primária via `tenant_branding`).
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'

interface MemorialLine {
  step: number
  label: string
  formula?: string
  valueCents?: number
  note?: string
}

interface MemorialPdfInput {
  yearMonth: string
  companyName: string
  taxRegime: string
  receitaServicosCents: number
  receitaMercadoriasCents: number
  receitaTotalCents: number
  rbt12Cents: number | null
  aliquotaEfetivaBp: number | null
  impostoApuradoCents: number
  memorial: MemorialLine[]
  breakdown: Array<{ emissionKind: string; count: number; totalCents: number }>
  closedAt: string | null
  generatedAt: string
}

const REGIME_LABEL: Record<string, string> = {
  simples_nacional: 'Simples Nacional',
  lucro_presumido: 'Lucro Presumido',
  lucro_real: 'Lucro Real',
  mei: 'MEI',
}

const EMISSION_KIND_LABEL: Record<string, string> = {
  nfse: 'NFS-e',
  nfe: 'NF-e',
  nfce: 'NFC-e',
  nfe_return: 'Devolução',
  nfe_transfer: 'Transferência',
  nfe_conserto_out: 'Conserto saída',
  nfe_conserto_return: 'Conserto retorno',
  nfe_self_entry: 'Entrada própria',
}

function formatBrl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100)
}

function formatAliquota(bp: number | null | undefined): string {
  if (bp === null || bp === undefined) return '—'
  return `${(bp / 100).toFixed(2)}%`
}

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: '#1f2937',
  },
  header: {
    marginBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#1e40af',
    paddingBottom: 8,
  },
  brand: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1e40af',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  subtitle: {
    fontSize: 9,
    color: '#6b7280',
    marginTop: 2,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 8,
    borderRadius: 4,
  },
  kpiLabel: {
    fontSize: 7,
    textTransform: 'uppercase',
    color: '#6b7280',
    letterSpacing: 0.5,
  },
  kpiValue: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 2,
  },
  kpiSubtitle: {
    fontSize: 7,
    color: '#6b7280',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 2,
  },
  table: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableRowLast: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  tableHeader: {
    backgroundColor: '#f9fafb',
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#6b7280',
  },
  colKind: { flex: 2 },
  colCount: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 2, textAlign: 'right' },
  memorialRow: {
    flexDirection: 'row',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  memorialStep: {
    width: 24,
    fontSize: 8,
    color: '#9ca3af',
    textAlign: 'right',
  },
  memorialLabel: {
    flex: 1,
    fontSize: 9,
  },
  memorialFormula: {
    fontSize: 7,
    color: '#6b7280',
    fontFamily: 'Courier',
    marginTop: 1,
  },
  memorialNote: {
    fontSize: 7,
    color: '#6b7280',
    marginTop: 1,
  },
  memorialValue: {
    width: 80,
    fontSize: 9,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  footer: {
    marginTop: 20,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    fontSize: 7,
    color: '#6b7280',
  },
})

function MemorialPdfDocument(input: MemorialPdfInput) {
  return (
    <Document
      title={`Apuração ${input.yearMonth} — ${input.companyName}`}
      author="LogiFit"
      subject="Apuração fiscal mensal — memorial de cálculo"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>LogiFit · Fiscal</Text>
          <Text style={styles.title}>Apuração {input.yearMonth}</Text>
          <Text style={styles.subtitle}>
            {input.companyName} · {REGIME_LABEL[input.taxRegime] ?? input.taxRegime} ·{' '}
            {input.closedAt
              ? `Fechada em ${new Date(input.closedAt).toLocaleString('pt-BR')}`
              : `Gerada em ${new Date(input.generatedAt).toLocaleString('pt-BR')}`}
          </Text>
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Receita Bruta</Text>
            <Text style={styles.kpiValue}>{formatBrl(input.receitaTotalCents)}</Text>
            <Text style={styles.kpiSubtitle}>
              Serv.: {formatBrl(input.receitaServicosCents)} · Merc.:{' '}
              {formatBrl(input.receitaMercadoriasCents)}
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Imposto Apurado</Text>
            <Text style={styles.kpiValue}>{formatBrl(input.impostoApuradoCents)}</Text>
            <Text style={styles.kpiSubtitle}>Estimativa pré-DAS/DARF</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Alíquota Efetiva</Text>
            <Text style={styles.kpiValue}>{formatAliquota(input.aliquotaEfetivaBp)}</Text>
            <Text style={styles.kpiSubtitle}>
              {input.rbt12Cents !== null ? `RBT12: ${formatBrl(input.rbt12Cents)}` : ''}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Quebra por tipo de nota</Text>
        {input.breakdown.length === 0 ? (
          <Text style={{ fontSize: 9, color: '#6b7280' }}>
            Sem emissões registradas no período.
          </Text>
        ) : (
          <View style={styles.table}>
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={styles.colKind}>Tipo</Text>
              <Text style={styles.colCount}>Quantidade</Text>
              <Text style={styles.colTotal}>Total</Text>
            </View>
            {input.breakdown.map((b, i) => (
              <View
                key={b.emissionKind}
                style={i === input.breakdown.length - 1 ? styles.tableRowLast : styles.tableRow}
              >
                <Text style={styles.colKind}>
                  {EMISSION_KIND_LABEL[b.emissionKind] ?? b.emissionKind}
                </Text>
                <Text style={styles.colCount}>{b.count}</Text>
                <Text style={styles.colTotal}>{formatBrl(b.totalCents)}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.sectionTitle}>Memorial do cálculo</Text>
        {input.memorial.length === 0 ? (
          <Text style={{ fontSize: 9, color: '#6b7280' }}>
            Memorial vazio — regenere a apuração.
          </Text>
        ) : (
          <View>
            {input.memorial.map((line, idx) => (
              <View key={`${line.step}-${idx}`} style={styles.memorialRow} wrap={false}>
                <Text style={styles.memorialStep}>#{line.step}</Text>
                <View style={styles.memorialLabel}>
                  <Text>{line.label}</Text>
                  {line.formula && <Text style={styles.memorialFormula}>{line.formula}</Text>}
                  {line.note && <Text style={styles.memorialNote}>{line.note}</Text>}
                </View>
                {line.valueCents !== undefined && (
                  <Text style={styles.memorialValue}>{formatBrl(line.valueCents)}</Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={styles.footer}>
          <Text>
            Documento gerado pelo motor LogiFit (ADR 0100) em{' '}
            {new Date(input.generatedAt).toLocaleString('pt-BR')}. Esta apuração é{' '}
            <Text style={{ fontWeight: 'bold' }}>operacional</Text> — a guia oficial DAS/DARF é
            emitida via Sprint 38. Valide o valor com seu contador antes do pagamento. Diferenças
            entre cálculo operacional e PGDAS-D oficial podem variar até ±5% nas faixas típicas.
          </Text>
        </View>
      </Page>
    </Document>
  )
}

/**
 * Renderiza o PDF do memorial como Buffer. Server-only (require dynamic).
 */
export async function renderMemorialPdf(input: MemorialPdfInput): Promise<Buffer> {
  return renderToBuffer(<MemorialPdfDocument {...input} />)
}
