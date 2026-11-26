/**
 * useAgentFilters
 *
 * Reads multi-criteria agent filter state from URL query params (via React
 * Router's useSearchParams) and writes changes back to the URL on every
 * update using `replace` so the history stack stays clean.
 *
 * URL param mapping:
 *   caps        – comma-separated capability list   e.g. research,coding
 *   pmin / pmax – price range in XLM                e.g. pmin=5&pmax=50
 *   rmin / rmax – reputation range 0–5              e.g. rmin=3&rmax=5
 *   available   – '1' when availableOnly is true
 *   status      – 'active' | 'inactive'
 *   sort / dir  – sort key and direction
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DEFAULT_FILTERS,
  countActiveFilters,
  filtersFromSearchParams,
  filtersToSearchParams,
  type AgentFilters,
} from '../utils/agentRegistry'

export interface UseAgentFiltersResult {
  /** Current filter state derived from URL params. */
  filters: AgentFilters
  /** Number of non-default filters currently applied — used for the badge. */
  activeFilterCount: number
  /** Replace the entire filter state at once. */
  setFilters: (next: AgentFilters) => void
  /** Merge a partial update into the current filter state. */
  updateFilters: (next: Partial<AgentFilters>) => void
  /** Convenience: toggle a capability on/off. */
  toggleCapability: (capability: string) => void
  /** Convenience: set the price range. */
  setPriceRange: (min: number | null, max: number | null) => void
  /** Convenience: set the reputation range. */
  setRepRange: (min: number | null, max: number | null) => void
  /** Convenience: toggle availableOnly. */
  setAvailableOnly: (value: boolean) => void
  /** Resets all filters to defaults and clears query params. */
  clearFilters: () => void
}

export function useAgentFilters(): UseAgentFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()

  // Derive typed filter state from URL — recomputed only when searchParams changes.
  const filters = useMemo(
    () => filtersFromSearchParams(searchParams),
    [searchParams]
  )

  const activeFilterCount = useMemo(
    () => countActiveFilters(filters),
    [filters]
  )

  // Write helper — always uses `replace` to avoid polluting history.
  const writeFilters = useCallback(
    (next: AgentFilters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true })
    },
    [setSearchParams]
  )

  const setFilters = useCallback(
    (next: AgentFilters) => writeFilters(next),
    [writeFilters]
  )

  const updateFilters = useCallback(
    (next: Partial<AgentFilters>) => writeFilters({ ...filters, ...next }),
    [filters, writeFilters]
  )

  const toggleCapability = useCallback(
    (capability: string) => {
      const already = filters.capabilities.includes(capability)
      writeFilters({
        ...filters,
        capabilities: already
          ? filters.capabilities.filter((c) => c !== capability)
          : [...filters.capabilities, capability],
      })
    },
    [filters, writeFilters]
  )

  const setPriceRange = useCallback(
    (min: number | null, max: number | null) =>
      writeFilters({ ...filters, priceMin: min, priceMax: max }),
    [filters, writeFilters]
  )

  const setRepRange = useCallback(
    (min: number | null, max: number | null) =>
      writeFilters({ ...filters, repMin: min, repMax: max }),
    [filters, writeFilters]
  )

  const setAvailableOnly = useCallback(
    (value: boolean) => writeFilters({ ...filters, availableOnly: value }),
    [filters, writeFilters]
  )

  const clearFilters = useCallback(
    () => setSearchParams({}, { replace: true }),
    [setSearchParams]
  )

  return {
    filters,
    activeFilterCount,
    setFilters,
    updateFilters,
    toggleCapability,
    setPriceRange,
    setRepRange,
    setAvailableOnly,
    clearFilters,
  }
}

export default useAgentFilters
