/**
 * ExportPaymentsModal
 *
 * Modal for exporting payment history in CSV or JSON format with optional
 * date range filtering. Supports keyboard navigation (ESC closes, focus trap).
 *
 * Props:
 *  - isOpen    — controls visibility
 *  - onClose   — called when the modal should close
 *  - payments  — full list of PaymentRow[] to filter and export
 *
 * Issue: #2
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, X } from 'lucide-react'
import type { PaymentRow } from '../../hooks/usePayments'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useToast } from '../../context/ToastContext'
import { exportPayments, triggerDownload } from '../../utils/exportPayments'
import styles from './ExportPaymentsModal.module.css'

type ExportFormat = 'csv' | 'json'

interface ExportPaymentsModalProps {
  isOpen: boolean
  onClose: () => void
  payments: PaymentRow[]
}

export function ExportPaymentsModal({ isOpen, onClose, payments }: ExportPaymentsModalProps) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exporting, setExporting] = useState(false)

  const { showToast } = useToast()
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen)

  // Close on ESC
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen])

  // Filter payments by the modal's own date range
  const filtered = useMemo(() => {
    const fromTime = startDate ? new Date(startDate).getTime() : null
    const toTime = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null
    if (fromTime === null && toTime === null) return payments
    return payments.filter((p) => {
      const t = new Date(p.date).getTime()
      if (Number.isNaN(t)) return true
      if (fromTime !== null && t < fromTime) return false
      if (toTime !== null && t > toTime) return false
      return true
    })
  }, [payments, startDate, endDate])

  const handleExport = async () => {
    setExporting(true)
    try {
      // Yield to the render cycle so the spinner shows before the (synchronous)
      // Blob construction blocks the thread on large datasets.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))

      const blob = exportPayments(filtered, format)
      const date = new Date().toISOString().slice(0, 10)
      const ext = format === 'json' ? 'json' : 'csv'
      triggerDownload(blob, `payments-${date}.${ext}`)

      showToast(`Exported ${filtered.length} payment${filtered.length !== 1 ? 's' : ''} as ${format.toUpperCase()}`, 'success')
      onClose()
    } finally {
      setExporting(false)
    }
  }

  if (!isOpen) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className={styles.backdrop}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Export payment history"
        className={styles.modal}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            <Download size={18} aria-hidden="true" />
            Export Payments
          </h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close export modal"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Format selector */}
          <div>
            <p className={styles.sectionLabel}>Format</p>
            <div className={styles.formatGroup} role="radiogroup" aria-label="Export format">
              <label className={`${styles.formatOption} ${format === 'csv' ? styles.selected : ''}`}>
                <input
                  type="radio"
                  name="export-format"
                  value="csv"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                  aria-label="CSV format"
                />
                CSV
              </label>
              <label className={`${styles.formatOption} ${format === 'json' ? styles.selected : ''}`}>
                <input
                  type="radio"
                  name="export-format"
                  value="json"
                  checked={format === 'json'}
                  onChange={() => setFormat('json')}
                  aria-label="JSON format"
                />
                JSON
              </label>
            </div>
          </div>

          {/* Date range */}
          <div>
            <p className={styles.sectionLabel}>Date range (optional)</p>
            <div className={styles.dateRange}>
              <div className={styles.fieldGroup}>
                <label htmlFor="export-start-date" className={styles.fieldLabel}>
                  From
                </label>
                <input
                  id="export-start-date"
                  type="date"
                  className={styles.dateInput}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || undefined}
                  aria-label="Export start date"
                />
              </div>
              <div className={styles.fieldGroup}>
                <label htmlFor="export-end-date" className={styles.fieldLabel}>
                  To
                </label>
                <input
                  id="export-end-date"
                  type="date"
                  className={styles.dateInput}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  aria-label="Export end date"
                />
              </div>
            </div>
          </div>

          {/* Summary */}
          <p className={styles.summary}>
            <span className={styles.summaryCount}>{filtered.length}</span>{' '}
            payment{filtered.length !== 1 ? 's' : ''} will be exported
            {(startDate || endDate) ? ' in the selected date range' : ''}
            .
          </p>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button
            className={styles.cancelButton}
            onClick={onClose}
            disabled={exporting}
          >
            Cancel
          </button>
          <button
            className={styles.exportButton}
            onClick={handleExport}
            disabled={exporting || filtered.length === 0}
            aria-label={`Export ${filtered.length} payments as ${format.toUpperCase()}`}
          >
            {exporting ? (
              <>
                <span className={styles.spinner} aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                <Download size={14} aria-hidden="true" />
                Export {format.toUpperCase()}
              </>
            )}
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}

export default ExportPaymentsModal
