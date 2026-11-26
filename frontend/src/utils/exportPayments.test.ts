import { describe, it, expect } from 'vitest'
import { exportPayments } from './exportPayments'
import type { PaymentRow } from '../hooks/usePayments'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BASE_PAYMENT: PaymentRow = {
  date: '2024-03-15T10:00:00.000Z',
  taskId: 'task-abc-123',
  agentsPaid: 'GAGENT000001',
  amountXLM: '10.0000000',
  status: 'completed',
  txHash: 'txhash000001',
  direction: 'out',
}

function makePayment(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return { ...BASE_PAYMENT, ...overrides }
}

// ─── Helper: read Blob as text ────────────────────────────────────────────────

async function blobText(blob: Blob): Promise<string> {
  // Blob.prototype.text() is not available in older jsdom versions;
  // fall back to FileReader which jsdom does support.
  if (typeof blob.text === 'function') {
    return blob.text()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

// ─── CSV tests ────────────────────────────────────────────────────────────────

describe('exportPayments — CSV', () => {
  it('produces the correct column headers as the first row', async () => {
    const blob = exportPayments([makePayment()], 'csv')
    const text = await blobText(blob)
    const firstLine = text.split('\n')[0]
    expect(firstLine).toBe('"date","taskId","agentId","amountXLM","status","txHash"')
  })

  it('produces one data row per payment', async () => {
    const payments = [makePayment(), makePayment({ taskId: 'task-xyz-456', txHash: 'txhash000002' })]
    const blob = exportPayments(payments, 'csv')
    const text = await blobText(blob)
    const lines = text.split('\n')
    // 1 header + 2 data rows
    expect(lines).toHaveLength(3)
  })

  it('maps payment fields to the correct columns', async () => {
    const payment = makePayment({
      date: '2024-06-01T08:00:00.000Z',
      taskId: 'task-mapped',
      agentsPaid: 'GAGENT_MAP',
      amountXLM: '5.5000000',
      status: 'released',
      txHash: 'txmap001',
    })
    const blob = exportPayments([payment], 'csv')
    const text = await blobText(blob)
    const dataRow = text.split('\n')[1]
    expect(dataRow).toContain('"2024-06-01T08:00:00.000Z"')
    expect(dataRow).toContain('"task-mapped"')
    expect(dataRow).toContain('"GAGENT_MAP"')
    expect(dataRow).toContain('"5.5000000"')
    expect(dataRow).toContain('"released"')
    expect(dataRow).toContain('"txmap001"')
  })

  it('properly escapes double-quotes in cell values', async () => {
    const payment = makePayment({ taskId: 'task "quoted" id' })
    const blob = exportPayments([payment], 'csv')
    const text = await blobText(blob)
    // RFC 4180: a double-quote inside a quoted field is doubled
    expect(text).toContain('"task ""quoted"" id"')
  })

  it('properly escapes commas in cell values', async () => {
    const payment = makePayment({ agentsPaid: 'Agent, With Comma' })
    const blob = exportPayments([payment], 'csv')
    const text = await blobText(blob)
    // Value with comma must be wrapped in quotes (all cells are quoted here)
    expect(text).toContain('"Agent, With Comma"')
  })

  it('produces headers-only output for an empty array', async () => {
    const blob = exportPayments([], 'csv')
    const text = await blobText(blob)
    expect(text.trim()).toBe('"date","taskId","agentId","amountXLM","status","txHash"')
  })

  it('returns a Blob with text/csv MIME type', () => {
    const blob = exportPayments([makePayment()], 'csv')
    expect(blob.type).toContain('text/csv')
  })

  it('handles newlines in cell values by wrapping them in quotes', async () => {
    const payment = makePayment({ taskId: 'line1\nline2' })
    const blob = exportPayments([payment], 'csv')
    const text = await blobText(blob)
    expect(text).toContain('"line1\nline2"')
  })
})

// ─── JSON tests ───────────────────────────────────────────────────────────────

describe('exportPayments — JSON', () => {
  it('returns valid, parseable JSON', async () => {
    const blob = exportPayments([makePayment()], 'json')
    const text = await blobText(blob)
    expect(() => JSON.parse(text)).not.toThrow()
  })

  it('output is a JSON array', async () => {
    const blob = exportPayments([makePayment()], 'json')
    const text = await blobText(blob)
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(true)
  })

  it('contains one entry per payment', async () => {
    const payments = [makePayment(), makePayment({ taskId: 'second' })]
    const blob = exportPayments(payments, 'json')
    const text = await blobText(blob)
    const parsed: PaymentRow[] = JSON.parse(text)
    expect(parsed).toHaveLength(2)
  })

  it('preserves all payment fields', async () => {
    const payment = makePayment()
    const blob = exportPayments([payment], 'json')
    const text = await blobText(blob)
    const parsed: PaymentRow[] = JSON.parse(text)
    expect(parsed[0]).toMatchObject(payment)
  })

  it('includes the direction field (not present in CSV columns)', async () => {
    const payment = makePayment({ direction: 'in' })
    const blob = exportPayments([payment], 'json')
    const text = await blobText(blob)
    const parsed: PaymentRow[] = JSON.parse(text)
    expect(parsed[0].direction).toBe('in')
  })

  it('produces an empty JSON array for no payments', async () => {
    const blob = exportPayments([], 'json')
    const text = await blobText(blob)
    const parsed = JSON.parse(text)
    expect(parsed).toEqual([])
  })

  it('returns a Blob with application/json MIME type', () => {
    const blob = exportPayments([makePayment()], 'json')
    expect(blob.type).toContain('application/json')
  })

  it('handles payments with special characters without throwing', async () => {
    const payment = makePayment({ taskId: '<script>alert("xss")</script>' })
    const blob = exportPayments([payment], 'json')
    const text = await blobText(blob)
    const parsed: PaymentRow[] = JSON.parse(text)
    expect(parsed[0].taskId).toBe('<script>alert("xss")</script>')
  })
})
