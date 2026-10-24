import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import styles from './DataTable.module.css';

export type SortDirection = 'asc' | 'desc';
export type MobileColumnPriority = 'primary' | 'secondary' | 'hidden-mobile';
export type MobileTableView = 'scroll' | 'cards';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  priority?: MobileColumnPriority;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
  width?: string;
  minWidth?: string;
}

// ─── Issue #16 Props API ──────────────────────────────────────────────────────

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  /** Primary data prop (Issue #16 API) */
  data?: T[];
  /** Legacy prop — aliased to `data`; prefer `data` for new code */
  rows?: T[];
  /** Show a loading skeleton overlay when true */
  loading?: boolean;
  /** Message shown in the empty state when data is empty */
  emptyMessage?: string;
  /** Number of rows per page for client-side pagination */
  pageSize?: number;
  /** Options rendered in the page-size selector */
  pageSizeOptions?: number[];
  /** Called when the user changes page (server-side mode) */
  onPageChange?: (page: number) => void;
  /** Called when the user changes sort (server-side mode) */
  onSortChange?: (key: string, direction: SortDirection) => void;

  // ─── Original props (kept for back-compat) ───────────────────────────────
  getRowKey?: (row: T) => string | number;
  emptyState?: React.ReactNode;
  className?: string;
  maxHeight?: number;
  stickyHeader?: boolean;
  virtualization?: boolean;
  rowHeight?: number;
  selectedRowKeys?: Array<string | number>;
  onRowSelect?: (row: T) => void;
  onRowClick?: (row: T) => void;
  /** Kept for back-compat; prefer onSortChange */
  onSort?: (key: string, direction: SortDirection) => void;
  rowClassName?: (row: T) => string;
  getRowTestId?: (row: T) => string;
  mobileView?: MobileTableView;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCellValue<T>(row: T, key: string): string | number | boolean | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

function sortRows<T>(rows: T[], key: string | null, direction: SortDirection): T[] {
  if (!key) return rows;

  return [...rows].sort((left, right) => {
    const leftValue = getCellValue(left, key);
    const rightValue = getCellValue(right, key);

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    if (leftValue === rightValue) return 0;

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    }

    const ls = String(leftValue).toLowerCase();
    const rs = String(rightValue).toLowerCase();
    return direction === 'asc' ? ls.localeCompare(rs) : rs.localeCompare(ls);
  });
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr className={styles.skeletonRow} aria-hidden="true">
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i}>
          <span className={styles.skeletonCell} />
        </td>
      ))}
    </tr>
  );
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  rows: rowsProp,
  loading = false,
  emptyMessage,
  pageSize: pageSizeProp,
  pageSizeOptions = [10, 25, 50],
  onPageChange,
  onSortChange,
  getRowKey,
  emptyState,
  className,
  maxHeight = 480,
  stickyHeader = true,
  virtualization = false,
  rowHeight = 48,
  selectedRowKeys = [],
  onRowSelect,
  onRowClick,
  onSort,
  rowClassName,
  getRowTestId,
  mobileView = 'scroll',
}: DataTableProps<T>) {
  // Normalise `data` vs legacy `rows` prop
  const allRows: T[] = data ?? rowsProp ?? [];

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(pageSizeProp ?? pageSizeOptions[0] ?? 10);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [scrollState, setScrollState] = useState({ overflowing: false, left: false, right: false });

  const updateScrollState = useCallback(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    const nextState = {
      overflowing: viewport.scrollWidth > viewport.clientWidth,
      left: viewport.scrollLeft > 0,
      right: viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 1,
    };
    setScrollState((current) => (
      current.overflowing === nextState.overflowing && current.left === nextState.left && current.right === nextState.right
        ? current
        : nextState
    ));
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;

    updateScrollState();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [columns.length, rows.length, updateScrollState]);

  // Re-sync controlled pageSize if the prop changes
  useEffect(() => {
    if (pageSizeProp !== undefined) setPageSize(pageSizeProp);
  }, [pageSizeProp]);

  // Reset to first page when data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [allRows.length]);

  const sortedRows = useMemo(
    () => sortRows(allRows, sortKey, sortDirection),
    [allRows, sortKey, sortDirection],
  );

  // ── Pagination ──────────────────────────────────────────────────────────────
  const isPaginated = pageSizeProp !== undefined || onPageChange !== undefined;
  const totalRows = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const pagedRows = isPaginated
    ? sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sortedRows;

  // ── Virtualisation ──────────────────────────────────────────────────────────
  const itemCount = pagedRows.length;
  const overscan = 6;
  const startIndex = virtualization
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    : 0;
  const endIndex = virtualization
    ? Math.min(itemCount, Math.ceil((scrollTop + maxHeight) / rowHeight) + overscan)
    : itemCount;
  const visibleRows = virtualization ? pagedRows.slice(startIndex, endIndex) : pagedRows;

  useEffect(() => {
    setActiveRowIndex((current) => Math.min(current, Math.max(visibleRows.length - 1, 0)));
    rowRefs.current = rowRefs.current.slice(0, visibleRows.length);
  }, [visibleRows.length]);

  // ── Row key helper ──────────────────────────────────────────────────────────
  const resolveRowKey = (row: T, index: number): string | number => {
    if (getRowKey) return getRowKey(row);
    const maybeId = (row as Record<string, unknown>)['id'];
    if (typeof maybeId === 'string' || typeof maybeId === 'number') return maybeId;
    return index;
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSort = (column: DataTableColumn<T>) => {
    if (!column.sortable) return;
    const nextKey = column.key;
    let nextDirection: SortDirection = 'asc';
    if (sortKey === nextKey) {
      nextDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    }
    setSortKey(nextKey);
    setSortDirection(nextDirection);
    onSort?.(nextKey, nextDirection);
    onSortChange?.(nextKey, nextDirection);
  };

  const handlePageChange = (page: number) => {
    const clamped = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(clamped);
    onPageChange?.(clamped);
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    onPageChange?.(1);
  };

  const focusRow = (index: number) => {
    const nextIndex = Math.min(Math.max(index, 0), visibleRows.length - 1);
    setActiveRowIndex(nextIndex);
    rowRefs.current[nextIndex]?.focus();
  };

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    index: number,
    row: T,
  ) => {
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(visibleRows.length - 1);
        break;
      case 'Enter':
      case ' ':
        if (onRowClick) {
          event.preventDefault();
          onRowClick(row);
        }
        break;
    }
  };

  // ── Empty / Loading states ──────────────────────────────────────────────────
  if (!loading && allRows.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        {emptyState ?? (
          <span className={styles.emptyMessage}>
            {emptyMessage ?? 'No rows available.'}
          </span>
        )}
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className={`${styles.wrapper} ${className ?? ''}`}
      style={{ maxHeight }}
      data-overflowing={scrollState.overflowing || undefined}
      data-scroll-left={scrollState.left || undefined}
      data-scroll-right={scrollState.right || undefined}
    >
      <div
        ref={scrollRef}
        className={styles.viewport}
        style={virtualization ? { maxHeight, overflowY: 'auto' } : undefined}
        onScroll={(event) => {
          if (virtualization) setScrollTop(event.currentTarget.scrollTop);
          updateScrollState();
        }}
      >
        <table className={`${styles.table} ${mobileView === 'cards' ? styles.mobileCards : ''}`} data-mobile-view={mobileView}>
          <thead className={stickyHeader ? styles.stickyHeader : ''}>
            <tr>
              {onRowSelect && <th className={styles.selectionCell} aria-label="Row selection" />}
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={[
                    column.sortable ? styles.sortableHeader : '',
                    column.priority === 'primary' ? styles.primaryColumn : '',
                    column.priority === 'hidden-mobile' ? styles.hiddenMobileColumn : '',
                  ].filter(Boolean).join(' ')}
                  data-priority={column.priority ?? 'secondary'}
                  style={{ width: column.width, minWidth: column.minWidth, resize: 'horizontal' }}
                  aria-sort={
                    column.sortable
                      ? sortKey === column.key
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                      : undefined
                  }
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => handleSort(column)}
                      aria-label={`Sort by ${column.header}`}
                    >
                      <span>{column.header}</span>
                      {sortKey === column.key ? (
                        sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => {
              const rowKey = getRowKey(row);
              const isSelected = selectedRowKeys.includes(rowKey);
              const classes = [styles.row, rowClassName ? rowClassName(row) : ''];
              if (isSelected) classes.push(styles.selectedRow);

              return (
                <tr
                  key={rowKey}
                  ref={(element) => { rowRefs.current[rowIndex] = element; }}
                  data-testid={getRowTestId ? getRowTestId(row) : `agent-row-${String(rowKey)}`}
                  className={classes.join(' ')}
                  onClick={() => onRowClick?.(row)}
                  onFocus={() => setActiveRowIndex(rowIndex)}
                  onKeyDown={(event) => handleRowKeyDown(event, rowIndex, row)}
                  tabIndex={rowIndex === activeRowIndex ? 0 : -1}
                  aria-selected={onRowSelect ? isSelected : undefined}
                >
                  {onRowSelect && (
                    <td className={styles.selectionCell}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelect(rowKey, row)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select row ${String(rowKey)}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={`${String(rowKey)}-${column.key}`}
                      className={[
                        column.className ?? '',
                        column.priority === 'primary' ? styles.primaryColumn : '',
                        column.priority === 'hidden-mobile' ? styles.hiddenMobileColumn : '',
                      ].filter(Boolean).join(' ')}
                      data-label={column.header}
                      data-priority={column.priority ?? 'secondary'}
                      title={typeof getCellValue(row, column.key) === 'string' ? String(getCellValue(row, column.key)) : undefined}
                    >
                      {column.render ? column.render(row) : getCellValue(row, column.key) ?? '—'}
                    </td>
                  ))}
                </select>
              </label>
            )}
            <span className={styles.paginationInfo}>
              {(safePage - 1) * pageSize + 1}–
              {Math.min(safePage * pageSize, totalRows)} of {totalRows}
            </span>
          </div>

          <div className={styles.paginationControls}>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => handlePageChange(1)}
              disabled={safePage === 1}
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => handlePageChange(safePage - 1)}
              disabled={safePage === 1}
              aria-label="Previous page"
            >
              ‹
            </button>

            {/* Page number buttons — show up to 5 pages around current */}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === totalPages ||
                  Math.abs(p - safePage) <= 2,
              )
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...');
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === '...' ? (
                  <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.pageButton} ${p === safePage ? styles.pageButtonActive : ''}`}
                    onClick={() => handlePageChange(p as number)}
                    aria-label={`Page ${p}`}
                    aria-current={p === safePage ? 'page' : undefined}
                  >
                    {p}
                  </button>
                ),
              )}

            <button
              type="button"
              className={styles.pageButton}
              onClick={() => handlePageChange(safePage + 1)}
              disabled={safePage === totalPages}
              aria-label="Next page"
            >
              ›
            </button>
            <button
              type="button"
              className={styles.pageButton}
              onClick={() => handlePageChange(totalPages)}
              disabled={safePage === totalPages}
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
