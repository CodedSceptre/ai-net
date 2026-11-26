/**
 * Tests for useAgentFilters hook.
 *
 * Covers:
 *   - Reading initial filter state from URL params
 *   - Writing filter changes back to URL params
 *   - Counting active (non-default) filters
 *   - Clearing all filters
 *   - Each setter (toggleCapability, setPriceRange, setRepRange, setAvailableOnly)
 */

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import React from 'react'
import { useAgentFilters } from './useAgentFilters'

// ── Helper: wrap the hook inside a MemoryRouter at a given initial URL ────────

function wrapper(initialSearch = '') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      MemoryRouter,
      { initialEntries: [`/${initialSearch}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, { path: '/', element: children as React.ReactElement })
      )
    )
  }
}

// ── Reading from URL params ───────────────────────────────────────────────────

describe('useAgentFilters — reading from URL params', () => {
  it('returns default filters when no query params are present', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    expect(result.current.filters.capabilities).toEqual([])
    expect(result.current.filters.priceMin).toBeNull()
    expect(result.current.filters.priceMax).toBeNull()
    expect(result.current.filters.repMin).toBeNull()
    expect(result.current.filters.repMax).toBeNull()
    expect(result.current.filters.availableOnly).toBe(false)
    expect(result.current.filters.status).toBe('all')
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('reads capability list from ?caps param', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research,coding'),
    })

    expect(result.current.filters.capabilities).toEqual(['research', 'coding'])
  })

  it('reads price range from ?pmin and ?pmax params', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?pmin=10&pmax=50'),
    })

    expect(result.current.filters.priceMin).toBe(10)
    expect(result.current.filters.priceMax).toBe(50)
  })

  it('reads reputation range from ?rmin and ?rmax params', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?rmin=3&rmax=5'),
    })

    expect(result.current.filters.repMin).toBe(3)
    expect(result.current.filters.repMax).toBe(5)
  })

  it('reads availableOnly from ?available=1', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?available=1'),
    })

    expect(result.current.filters.availableOnly).toBe(true)
  })

  it('reads status filter from ?status=active', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?status=active'),
    })

    expect(result.current.filters.status).toBe('active')
  })
})

// ── Counting active filters ───────────────────────────────────────────────────

describe('useAgentFilters — counting active filters', () => {
  it('returns 0 when all params are default', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('counts each distinct filter group as 1', () => {
    // caps + price + rep + available = 4
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research&pmin=5&rmin=3&available=1'),
    })
    expect(result.current.activeFilterCount).toBe(4)
  })

  it('counts price as 1 regardless of whether only min or max is set', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?pmax=20'),
    })
    expect(result.current.activeFilterCount).toBe(1)
  })

  it('counts multiple capabilities as 1 filter group', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research,coding,design'),
    })
    expect(result.current.activeFilterCount).toBe(1)
  })
})

// ── Writing filter changes to URL params ──────────────────────────────────────

describe('useAgentFilters — writing to URL params', () => {
  it('toggleCapability adds a capability to the URL', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    act(() => {
      result.current.toggleCapability('research')
    })

    expect(result.current.filters.capabilities).toContain('research')
  })

  it('toggleCapability removes an already-selected capability', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research,coding'),
    })

    act(() => {
      result.current.toggleCapability('research')
    })

    expect(result.current.filters.capabilities).not.toContain('research')
    expect(result.current.filters.capabilities).toContain('coding')
  })

  it('setPriceRange updates priceMin and priceMax in URL', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    act(() => {
      result.current.setPriceRange(5, 40)
    })

    expect(result.current.filters.priceMin).toBe(5)
    expect(result.current.filters.priceMax).toBe(40)
  })

  it('setRepRange updates repMin and repMax in URL', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    act(() => {
      result.current.setRepRange(2.5, 4.5)
    })

    expect(result.current.filters.repMin).toBe(2.5)
    expect(result.current.filters.repMax).toBe(4.5)
  })

  it('setAvailableOnly sets availableOnly to true', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    act(() => {
      result.current.setAvailableOnly(true)
    })

    expect(result.current.filters.availableOnly).toBe(true)
  })

  it('updateFilters merges a partial update into existing state', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research&pmin=5'),
    })

    act(() => {
      result.current.updateFilters({ priceMax: 80 })
    })

    // caps and pmin are preserved; priceMax is added
    expect(result.current.filters.capabilities).toContain('research')
    expect(result.current.filters.priceMin).toBe(5)
    expect(result.current.filters.priceMax).toBe(80)
  })
})

// ── Clearing all filters ──────────────────────────────────────────────────────

describe('useAgentFilters — clearFilters', () => {
  it('resets all filters to defaults and clears query params', () => {
    const { result } = renderHook(() => useAgentFilters(), {
      wrapper: wrapper('?caps=research,coding&pmin=10&pmax=50&rmin=3&available=1&status=active'),
    })

    // Confirm filters are set before clearing
    expect(result.current.activeFilterCount).toBeGreaterThan(0)

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.filters.capabilities).toEqual([])
    expect(result.current.filters.priceMin).toBeNull()
    expect(result.current.filters.priceMax).toBeNull()
    expect(result.current.filters.repMin).toBeNull()
    expect(result.current.filters.repMax).toBeNull()
    expect(result.current.filters.availableOnly).toBe(false)
    expect(result.current.filters.status).toBe('all')
    expect(result.current.activeFilterCount).toBe(0)
  })

  it('clearFilters is a no-op when filters are already at defaults', () => {
    const { result } = renderHook(() => useAgentFilters(), { wrapper: wrapper() })

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.activeFilterCount).toBe(0)
  })
})
