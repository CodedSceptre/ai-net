# ai-net Design System

The design system is driven by `frontend/src/styles/tokens.css` and exposed to Tailwind through `frontend/tailwind.config.js`. Components should consume semantic tokens instead of raw colors, radii, shadows, or spacing values.

## Token Groups

| Group | Examples | Usage |
|---|---|---|
| Surface | `--surface-canvas`, `--surface-primary`, `--surface-raised`, `--surface-overlay` | Page backgrounds, panels, popovers, scrims |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-inverse` | Body copy, labels, metadata, text on filled accents |
| Border | `--border-primary`, `--border-subtle`, `--border-muted`, `--border-strong` | Input, panel, table, and divider borders |
| Accent | `--accent`, `--accent-info`, `--accent-text`, `--accent-surface`, `--accent-border` | Primary actions, focus states, selected states |
| Status | `--status-success-*`, `--status-warning-*`, `--status-danger-*` | Success, pending, warning, failed, destructive states |
| Agent | `--agent-research`, `--agent-risk`, `--agent-coding`, `--agent-design`, `--agent-report` | Agent labels, badges, timeline markers |
| Layout | `--space-*`, `--radius-*`, `--shadow-*`, `--focus-ring` | Component spacing, shape, elevation, focus treatment |

## Theme Model

The dark theme is defined on `:root` and `.theme-dark`; `.theme-light` overrides the same semantic variables. Components should not branch manually for light and dark themes. Prefer:

```css
.panel {
  background: var(--surface-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
```

Tailwind names mirror the semantic layer:

```tsx
<section className="bg-surface-primary text-text-primary border border-border-subtle rounded-lg shadow-sm">
  ...
</section>
```

## Component Conventions

Buttons use semantic accent and status tokens. Primary actions use `--gradient-primary` or `--accent`; destructive actions use `--status-danger` and `--status-danger-surface`. Disabled controls use `--text-muted` or `--text-disabled`.

Form fields use `--surface-primary`, `--border-primary`, `--focus-ring`, and status tokens for validation. Use `--radius-lg` or `--radius-xl`; avoid one-off pixel radii.

Cards are for repeated items, modals, and framed tools only. Keep card radius at `--radius-lg` or `--radius-xl`; page sections should be full-width bands or unframed layouts.

Tables, lists, timelines, and dashboards should use `--surface-*`, `--border-*`, and `--text-*` tokens for dense, scan-friendly operational UI.

Agent visuals use the `--agent-*` token set. Do not hard-code agent hex colors in components.

### Agent Tokens and Tailwind

The agent color tokens (`--agent-research`, `--agent-risk`, `--agent-coding`, `--agent-design`, `--agent-report`) and their `-surface` and `-border` variants are **not exposed as named Tailwind classes** in `tailwind.config.js`. This is intentional — the set of agent types is extensible and they are consumed by a small number of components.

**Use inline `style` props with `var()` references** when you need agent token colors in JSX:

```tsx
// ✅ Correct — use inline styles with CSS variables
const capabilityTokens = {
  research: {
    color: 'var(--agent-research)',
    surface: 'var(--agent-research-surface)',
    border: 'var(--agent-research-border)',
  },
  // ...
}

<span
  className="px-2 py-0.5 rounded-full border text-xs"
  style={{ color: tokens.color, backgroundColor: tokens.surface, borderColor: tokens.border }}
>
  research
</span>

// ❌ Wrong — hardcoded hex values that break theming
<span className="text-[#60A5FA] bg-[#60A5FA]/15 border-[#60A5FA]/30">research</span>

// ❌ Wrong — inline hex values
<span style={{ color: '#60A5FA' }}>research</span>
```

For icon colors in demo/marketing components use the same `style={{ color: 'var(--agent-research)' }}` pattern rather than Tailwind arbitrary classes.

If a future refactor warrants exposing agent tokens to Tailwind (e.g., more widespread use across non-landing components), add them to the `colors.agent` section of `tailwind.config.js` following the pattern of the existing `accent` and `status` tokens.

Shadows and glow effects use `--shadow-*`, `--glow-*`, or `--info-glow-*`. Do not add raw `rgba()` shadows in component CSS.

## Review Checklist

Before merging UI changes:

1. Check new CSS/TSX for raw `#hex`, `rgb()`, `rgba()`, one-off shadow values, and arbitrary radii.
2. Confirm any remaining raw values are user content, canvas drawing internals, or a new value that belongs in `tokens.css`.
3. Verify light and dark themes inherit from the same semantic token names.
4. Prefer Tailwind semantic names over arbitrary values when the token exists.

---

## WCAG AA Dark Mode Contrast Audit

Audit completed: 2026-10-24. Standard: WCAG 2.1 AA.
Ratios measured against the dark theme surfaces defined in `:root` / `.theme-dark` in `tokens.css`.

### Requirements

| Use case | Minimum ratio | Standard |
|---|---|---|
| Normal text (< 18px or < 14px bold) | 4.5:1 | WCAG 1.4.3 |
| Large text (≥ 18px or ≥ 14px bold) | 3.0:1 | WCAG 1.4.3 |
| UI components & focus indicators | 3.0:1 | WCAG 1.4.11 |

### Surface Reference (Dark Mode)

| Token | Hex | Luminance |
|---|---|---|
| `--surface-canvas` | `#0a0e14` | 0.004 |
| `--surface-primary` | `#11151d` | 0.008 |
| `--surface-secondary` | `#161b24` | 0.013 |
| `--surface-raised` | `#1a1f2e` | 0.018 |
| `--surface-elevated` | `#1e293b` | 0.026 |

### Text Token Contrast Ratios — Dark Mode

All ratios are text-on-background. ✅ = PASS AA (≥ 4.5:1). ⚠️ = PASS large only (≥ 3:1). ❌ = FAIL.

#### `--text-primary` · `#f5f7fa`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 18.02:1 | ✅ |
| `--surface-primary` `#11151d` | 17.03:1 | ✅ |
| `--surface-secondary` `#161b24` | 16.09:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 15.29:1 | ✅ |

#### `--text-secondary` · `#8a93a3`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 6.25:1 | ✅ |
| `--surface-primary` `#11151d` | 5.90:1 | ✅ |
| `--surface-secondary` `#161b24` | 5.58:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 5.30:1 | ✅ |

#### `--text-muted` · `#94a3b8`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 7.54:1 | ✅ |
| `--surface-primary` `#11151d` | 7.13:1 | ✅ |
| `--surface-secondary` `#161b24` | 6.73:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 6.40:1 | ✅ |

#### `--text-subtle` · `rgba(148, 163, 184, 0.85)` — *was `0.60` opacity*

Resolved to approximately `#808ea1` on `--surface-primary`.

| Background token | Resolved hex | Ratio | Result |
|---|---|---|---|
| `--surface-canvas` `#0a0e14` | `#7f8d9f` | 5.72:1 | ✅ |
| `--surface-primary` `#11151d` | `#808ea1` | 5.49:1 | ✅ |
| `--surface-secondary` `#161b24` | `#828fa2` | 5.27:1 | ✅ |
| `--surface-raised` `#1a1f2e` | `#8390a3` | 5.09:1 | ✅ |

> **Fix applied:** Opacity raised from `0.60` (3.34:1, ❌ FAIL AA on `--surface-primary`) to `0.85` (5.49:1, ✅).

#### `--text-disabled` · `rgba(148, 163, 184, 0.35)`

Disabled text is intentionally non-readable; contrast requirements do not apply per WCAG 1.4.3 exception. Do not use for any interactive or informational text.

---

### Accent Token Contrast Ratios — Dark Mode

#### `--accent` · `#8b5cf6` — *brand color, focus outlines, icons*

> **Do NOT use `--accent` directly as text color on dark surfaces.** It fails 4.5:1 on `--surface-primary` through `--surface-raised`. Use `--accent-text-interactive` for links and interactive labels.

| Background token | Ratio | Use as text? | Use as UI element? |
|---|---|---|---|
| `--surface-canvas` `#0a0e14` | 4.57:1 | ✅ (barely) | ✅ |
| `--surface-primary` `#11151d` | 4.32:1 | ❌ FAIL AA | ✅ |
| `--surface-secondary` `#161b24` | 4.08:1 | ❌ FAIL AA | ✅ |
| `--surface-raised` `#1a1f2e` | 3.88:1 | ❌ FAIL AA | ✅ |

#### `--accent-text-interactive` · `#a78bfa` — *use for all accent-colored text*

| Background token | Ratio | Result |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 7.11:1 | ✅ |
| `--surface-primary` `#11151d` | 6.72:1 | ✅ |
| `--surface-secondary` `#161b24` | 6.34:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 6.03:1 | ✅ |

#### `--accent-text-strong` · `#a78bfa` — *same value as `--accent-text-interactive`*

All ratios identical to `--accent-text-interactive` above. ✅ everywhere.

#### `--accent-btn` · `#7c3aed` — *primary button backgrounds*

> **Fix applied.** Primary buttons were using `--accent` (`#8b5cf6`) as background with white labels (4.23:1, ❌). The dedicated `--accent-btn` token (`#7c3aed`, = former `--accent-hover`) achieves **5.70:1** with white text, ✅.

| Foreground | Ratio | Result |
|---|---|---|
| `#ffffff` (button label) | 5.70:1 | ✅ |

#### `--accent-text-muted` · `#818cf8`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-primary` `#11151d` | 6.13:1 | ✅ |
| `--surface-secondary` `#161b24` | 5.79:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 5.50:1 | ✅ |

---

### Status Token Contrast Ratios — Dark Mode

#### `--status-danger` · `#ef4444` — *borders and backgrounds only*

> **Do NOT use `--status-danger` directly as text on `--surface-raised`.** It achieves 4.36:1 (❌ FAIL AA). Use `--status-danger-text` (`#fca5a5`) for inline error messages.

| Background token | Ratio | Use as text? |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 5.14:1 | ✅ |
| `--surface-primary` `#11151d` | 4.86:1 | ✅ |
| `--surface-secondary` `#161b24` | 4.59:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 4.36:1 | ❌ |

#### `--status-danger-text` · `#fca5a5` — *use for all inline danger/error text*

| Background token | Ratio | Result |
|---|---|---|
| `--surface-canvas` `#0a0e14` | 10.16:1 | ✅ |
| `--surface-primary` `#11151d` | 9.63:1 | ✅ |
| `--surface-secondary` `#161b24` | 9.09:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 8.65:1 | ✅ |

#### `--status-success-text` · `#a7f3d0`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-primary` `#11151d` | 9.97:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 8.95:1 | ✅ |

#### `--status-warning-text` · `#fde68a`

| Background token | Ratio | Result |
|---|---|---|
| `--surface-primary` `#11151d` | 11.63:1 | ✅ |
| `--surface-raised` `#1a1f2e` | 10.43:1 | ✅ |

---

### Focus Indicator Contrast — Dark Mode

The visible focus outline is `3px solid var(--accent)` (`#8b5cf6`) with `outline-offset: 2px` (global.css). WCAG 1.4.11 requires 3:1 for non-text contrast.

| Background token | Focus color | Ratio | Result |
|---|---|---|---|
| `--surface-canvas` `#0a0e14` | `#8b5cf6` | 4.57:1 | ✅ |
| `--surface-primary` `#11151d` | `#8b5cf6` | 4.32:1 | ✅ |
| `--surface-secondary` `#161b24` | `#8b5cf6` | 4.08:1 | ✅ |
| `--surface-raised` `#1a1f2e` | `#8b5cf6` | 3.88:1 | ✅ |

> Note: `--focus-ring` is a `box-shadow` glow supplement (`rgba(99,102,241,0.15)`), not the primary focus indicator. It does not need to meet contrast requirements independently.

---

### Audit Summary

| # | Violation | Token | Surface | Old ratio | New ratio | Status |
|---|---|---|---|---|---|---|
| 1 | Normal text fails AA | `--text-subtle` (opacity 0.60) | `--surface-primary` | 3.34:1 | 5.49:1 | ✅ Fixed |
| 2 | Accent text fails AA | `--accent` (#8b5cf6) used as text | `--surface-raised` | 3.88:1 | — | ✅ Fixed — added `--accent-text-interactive` (#a78bfa, 6.03:1) |
| 3 | Danger text fails AA | `--status-danger` (#ef4444) as text | `--surface-raised` | 4.36:1 | — | ✅ Fixed — added guidance to use `--status-danger-text` (#fca5a5, 8.65:1) |
| 4 | Button label fails AA | White on `--accent` button | — | 4.23:1 | 5.70:1 | ✅ Fixed — added `--accent-btn` (#7c3aed) |

All other checked text/surface combinations passed WCAG AA before the audit.

### Automated Enforcement

Contrast regressions are caught by two complementary mechanisms in `frontend/tests/e2e/accessibility.spec.ts`:

1. **axe-core page scans** — `@axe-core/playwright` runs the `color-contrast` rule against rendered pages in dark mode (landing, dashboard, agents, task submission, task history, wallet).
2. **Token contract tests** — Pure-JS WCAG arithmetic verifies every text token's ratio against every dark surface without needing a running server, so a single token change is caught immediately.
