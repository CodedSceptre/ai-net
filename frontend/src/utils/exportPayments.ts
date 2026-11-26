import type { PaymentRow } from '../hooks/usePayments'

/**
 * exportPayments — pure function that converts payment rows to a downloadable Blob.
 *
 * @param payments - Array of payment rows to export (pre-filtered by date range)
 * @param format   - 'csv' or 'json'
 * @returns        Blob ready for download
 */
export function exportPayments(payments: PaymentRow[], format: 'csv' | 'json'): Blob {
  if (format === 'json') {
    const json = JSON.stringify(payments, null, 2)
    return new Blob([json], { type: 'application/json;charset=utf-8;' })
  }

  // CSV
  const headers = ['date', 'taskId', 'agentId', 'amountXLM', 'status', 'txHash']
  const escapeCell = (value: string): string => `"${String(value).replace(/"/g, '""')}"`
  const rows = payments.map((p) => [
    p.date,
    p.taskId,
    p.agentsPaid,
    p.amountXLM,
    p.status,
    p.txHash,
  ])
  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCell(String(cell))).join(','))
    .join('\n')
  return new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
}

/**
 * triggerDownload — triggers a browser file download for a given Blob.
 * Caller is responsible for creating the Blob; this function only handles DOM interaction.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
