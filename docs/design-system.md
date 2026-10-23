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
