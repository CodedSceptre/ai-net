/**
 * Pagination
 *
 * Reusable pagination component with page number buttons, prev/next,
 * ellipsis for large page ranges, jump-to-page input, page size selector,
 * and results summary.
 *
 * URL integration is the consumer's responsibility. This component is
 * purely controlled — it calls onPageChange / onPageSizeChange and lets
 * the parent decide how to persist state (e.g. via useSearchParams).
 *
 * Keyboard shortcuts (window-level, skipped when an input/textarea/select
 * is focused):
 *   ArrowLeft  → previous page
 *   ArrowRight → next page
 *   Home       → first page
 *   End        → last page
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './Pagination.module.css'

export interface PaginationProps {
  /** 1-indexed current page */
  currentPage: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  /** Defaults to [10, 25, 50, 100] */
  pageSizeOptions?: number[]
  className?: string
}

type PageItem = number | 'ellipsis-start' | 'ellipsis-end'

function getPageNumbers(currentPage: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const items: PageItem[] = []
  const delta = 2

  // Always include page 1
  items.push(1)

  const rangeStart = Math.max(2, currentPage - delta)
  const rangeEnd = Math.min(totalPages - 1, currentPage + delta)

  if (rangeStart > 2) {
    items.push('ellipsis-start')
  }

  for (let i = rangeStart; i <= rangeEnd; i++) {
    items.push(i)
  }

  if (rangeEnd < totalPages - 1) {
    items.push('ellipsis-end')
  }

  // Always include last page
  items.push(totalPages)

  return items
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: PaginationProps) {
  const [jumpValue, setJumpValue] = useState('')
  const jumpInputRef = useRef<HTMLInputElement>(null)

  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const end = Math.min(currentPage * pageSize, totalItems)

  const pageItems = getPageNumbers(currentPage, totalPages)

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return
      }

      switch (event.key) {
        case 'ArrowLeft':
          if (currentPage > 1) onPageChange(currentPage - 1)
          break
        case 'ArrowRight':
          if (currentPage < totalPages) onPageChange(currentPage + 1)
          break
        case 'Home':
          if (currentPage !== 1) onPageChange(1)
          break
        case 'End':
          if (currentPage !== totalPages) onPageChange(totalPages)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentPage, totalPages, onPageChange])

  const handleJumpKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    const parsed = parseInt(jumpValue, 10)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= totalPages) {
      onPageChange(parsed)
    }
    setJumpValue('')
    jumpInputRef.current?.blur()
  }

  const handlePageSizeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const size = parseInt(event.target.value, 10)
    onPageSizeChange?.(size)
    onPageChange(1)
  }

  return (
    <nav
      aria-label="Pagination"
      className={`${styles.pagination}${className ? ` ${className}` : ''}`}
    >
      <div className={styles.paginationControls}>
        {/* Previous */}
        <button
          type="button"
          className={styles.prevNextBtn}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Previous page"
          aria-disabled={currentPage <= 1}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Previous</span>
        </button>

        {/* Page number buttons */}
        <div className={styles.pageNumbers} role="list">
          {pageItems.map((item, index) => {
            if (item === 'ellipsis-start' || item === 'ellipsis-end') {
              return (
                <span
                  key={item}
                  className={styles.ellipsis}
                  aria-hidden="true"
                >
                  &hellip;
                </span>
              )
            }
            const isActive = item === currentPage
            return (
              <button
                key={`page-${item}-${index}`}
                type="button"
                role="listitem"
                className={`${styles.pageBtn}${isActive ? ` ${styles.active}` : ''}`}
                onClick={() => onPageChange(item)}
                aria-label={`Page ${item}`}
                aria-current={isActive ? 'page' : undefined}
                disabled={isActive}
              >
                {item}
              </button>
            )
          })}
        </div>

        {/* Next */}
        <button
          type="button"
          className={styles.prevNextBtn}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Next page"
          aria-disabled={currentPage >= totalPages}
        >
          <span>Next</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className={styles.paginationMeta}>
        {/* Results summary */}
        <span className={styles.resultsSummary} aria-live="polite" aria-atomic="true">
          Showing {start}–{end} of {totalItems} results
        </span>

        {/* Jump to page */}
        <label className={styles.jumpLabel}>
          <span className={styles.jumpLabelText}>Go to page</span>
          <input
            ref={jumpInputRef}
            type="number"
            min={1}
            max={totalPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={handleJumpKeyDown}
            className={styles.jumpInput}
            aria-label={`Jump to page, 1 to ${totalPages}`}
            placeholder="–"
          />
        </label>

        {/* Page size selector */}
        {onPageSizeChange && (
          <label className={styles.pageSizeLabel}>
            <span className={styles.pageSizeLabelText}>Per page</span>
            <select
              value={pageSize}
              onChange={handlePageSizeChange}
              className={styles.pageSizeSelect}
              aria-label="Items per page"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </nav>
  )
}
