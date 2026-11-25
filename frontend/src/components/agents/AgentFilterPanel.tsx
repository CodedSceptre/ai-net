/**
 * AgentFilterPanel
 *
 * Collapsible sidebar filter panel for the agent registry.
 *
 * Controls:
 *   - Capability multi-select checkboxes (research, risk, coding, design, report)
 *   - Reputation dual-handle range (0–5 stars, 0.1 step)
 *   - Price dual-handle range (0–100 XLM, 1 XLM step)
 *   - Availability toggle (show only active agents)
 *   - "Clear All Filters" button
 *
 * The collapse toggle button shows an active-filter count badge, e.g. "Filters (3)".
 * All controls are keyboard accessible.
 */

import { useState } from 'react'
import { SlidersHorizontal, X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentFilters } from '../../utils/agentRegistry'
import styles from './AgentFilterPanel.module.css'

// Fixed capability list as specified in the issue.
const CAPABILITY_OPTIONS = ['research', 'risk', 'coding', 'design', 'report'] as const

const PRICE_MIN = 0
const PRICE_MAX = 100
const REP_MIN = 0
const REP_MAX = 5

export interface AgentFilterPanelProps {
  filters: AgentFilters
  activeFilterCount: number
  onUpdateFilters: (next: Partial<AgentFilters>) => void
  onClearFilters: () => void
  /** Extra class applied to the root element. */
  className?: string
}

export function AgentFilterPanel({
  filters,
  activeFilterCount,
  onUpdateFilters,
  onClearFilters,
  className = '',
}: AgentFilterPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  // ── Capability helpers ──────────────────────────────────────────────────────
  const toggleCapability = (cap: string) => {
    const already = filters.capabilities.includes(cap)
    onUpdateFilters({
      capabilities: already
        ? filters.capabilities.filter((c) => c !== cap)
        : [...filters.capabilities, cap],
    })
  }

  // ── Price range helpers ─────────────────────────────────────────────────────
  const priceMin = filters.priceMin ?? PRICE_MIN
  const priceMax = filters.priceMax ?? PRICE_MAX

  const handlePriceMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    onUpdateFilters({
      priceMin: val <= PRICE_MIN ? null : val,
      // keep max >= min
      priceMax: filters.priceMax != null && filters.priceMax < val ? val : filters.priceMax,
    })
  }

  const handlePriceMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    onUpdateFilters({
      priceMax: val >= PRICE_MAX ? null : val,
      // keep min <= max
      priceMin: filters.priceMin != null && filters.priceMin > val ? val : filters.priceMin,
    })
  }

  // ── Reputation range helpers ────────────────────────────────────────────────
  const repMin = filters.repMin ?? REP_MIN
  const repMax = filters.repMax ?? REP_MAX

  const handleRepMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    onUpdateFilters({
      repMin: val <= REP_MIN ? null : val,
      repMax: filters.repMax != null && filters.repMax < val ? val : filters.repMax,
    })
  }

  const handleRepMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    onUpdateFilters({
      repMax: val >= REP_MAX ? null : val,
      repMin: filters.repMin != null && filters.repMin > val ? val : filters.repMin,
    })
  }

  return (
    <aside
      className={`${styles.panel} ${collapsed ? styles.panelCollapsed : ''} ${className}`}
      aria-label="Agent filters"
      data-testid="agent-filter-panel"
    >
      {/* ── Toggle button ───────────────────────────────────────────────────── */}
      <button
        type="button"
        className={styles.toggleBtn}
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        aria-controls="agent-filter-panel-body"
        data-testid="filter-panel-toggle"
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        {!collapsed && (
          <span className={styles.toggleLabel}>
            Filters
            {activeFilterCount > 0 && (
              <span className={styles.badge} data-testid="filter-count-badge">
                {activeFilterCount}
              </span>
            )}
          </span>
        )}
        {collapsed && activeFilterCount > 0 && (
          <span className={styles.badge} data-testid="filter-count-badge">
            {activeFilterCount}
          </span>
        )}
        <span className={styles.chevron} aria-hidden="true">
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </span>
      </button>

      {/* ── Panel body ─────────────────────────────────────────────────────── */}
      <div
        id="agent-filter-panel-body"
        className={styles.body}
        hidden={collapsed}
        data-testid="filter-panel-body"
      >
        {/* ── Capabilities ─────────────────────────────────────────────────── */}
        <fieldset className={styles.section}>
          <legend className={styles.sectionLabel}>Capability</legend>
          <div className={styles.checkList} role="group" aria-label="Filter by capability">
            {CAPABILITY_OPTIONS.map((cap) => {
              const checked = filters.capabilities.includes(cap)
              return (
                <label
                  key={cap}
                  className={`${styles.checkLabel} ${checked ? styles.checkLabelChecked : ''}`}
                  data-testid={`capability-filter-${cap}`}
                >
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checked}
                    onChange={() => toggleCapability(cap)}
                    aria-label={cap}
                  />
                  <span className={styles.capName}>{cap}</span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {/* ── Reputation range ─────────────────────────────────────────────── */}
        <fieldset className={styles.section}>
          <legend className={styles.sectionLabel}>
            Reputation
            <span className={styles.rangeValue} aria-live="polite">
              {repMin === REP_MIN && repMax === REP_MAX
                ? 'Any'
                : `${repMin.toFixed(1)} – ${repMax.toFixed(1)} ★`}
            </span>
          </legend>
          <div className={styles.dualSlider} aria-label="Reputation range">
            <input
              type="range"
              className={styles.slider}
              min={REP_MIN}
              max={REP_MAX}
              step={0.1}
              value={repMin}
              onChange={handleRepMinChange}
              aria-label={`Minimum reputation: ${repMin.toFixed(1)} stars`}
              aria-valuemin={REP_MIN}
              aria-valuemax={REP_MAX}
              aria-valuenow={repMin}
              data-testid="rep-min-slider"
            />
            <input
              type="range"
              className={styles.slider}
              min={REP_MIN}
              max={REP_MAX}
              step={0.1}
              value={repMax}
              onChange={handleRepMaxChange}
              aria-label={`Maximum reputation: ${repMax.toFixed(1)} stars`}
              aria-valuemin={REP_MIN}
              aria-valuemax={REP_MAX}
              aria-valuenow={repMax}
              data-testid="rep-max-slider"
            />
          </div>
        </fieldset>

        {/* ── Price range ──────────────────────────────────────────────────── */}
        <fieldset className={styles.section}>
          <legend className={styles.sectionLabel}>
            Price (XLM)
            <span className={styles.rangeValue} aria-live="polite">
              {priceMin === PRICE_MIN && priceMax === PRICE_MAX
                ? 'Any'
                : `${priceMin} – ${priceMax} XLM`}
            </span>
          </legend>
          <div className={styles.dualSlider} aria-label="Price range">
            <input
              type="range"
              className={styles.slider}
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={1}
              value={priceMin}
              onChange={handlePriceMinChange}
              aria-label={`Minimum price: ${priceMin} XLM`}
              aria-valuemin={PRICE_MIN}
              aria-valuemax={PRICE_MAX}
              aria-valuenow={priceMin}
              data-testid="price-min-slider"
            />
            <input
              type="range"
              className={styles.slider}
              min={PRICE_MIN}
              max={PRICE_MAX}
              step={1}
              value={priceMax}
              onChange={handlePriceMaxChange}
              aria-label={`Maximum price: ${priceMax} XLM`}
              aria-valuemin={PRICE_MIN}
              aria-valuemax={PRICE_MAX}
              aria-valuenow={priceMax}
              data-testid="price-max-slider"
            />
          </div>
        </fieldset>

        {/* ── Availability toggle ───────────────────────────────────────────── */}
        <div className={styles.section}>
          <label className={styles.toggleRow} data-testid="availability-toggle-label">
            <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
              Available only
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={filters.availableOnly}
              className={`${styles.toggleSwitch} ${filters.availableOnly ? styles.toggleSwitchOn : ''}`}
              onClick={() => onUpdateFilters({ availableOnly: !filters.availableOnly })}
              aria-label="Show only available agents"
              data-testid="availability-toggle"
            >
              <span className={styles.toggleThumb} />
            </button>
          </label>
        </div>

        {/* ── Clear all ────────────────────────────────────────────────────── */}
        {activeFilterCount > 0 && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={onClearFilters}
            data-testid="clear-filters-btn"
          >
            <X size={13} aria-hidden="true" />
            Clear all filters
          </button>
        )}
      </div>
    </aside>
  )
}

export default AgentFilterPanel
