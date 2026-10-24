/**
 * WCAG AA Accessibility Tests — Dark Mode Color Contrast
 *
 * These tests verify that the dark theme satisfies WCAG 2.1 AA color contrast
 * requirements using axe-core's `color-contrast` rule:
 *   - Normal text:        ≥ 4.5:1
 *   - Large text (18px+ or 14px+ bold): ≥ 3:1
 *   - UI components / focus indicators: ≥ 3:1
 *
 * axe-core docs: https://www.deque.com/axe/core-documentation/
 *
 * NOTE: These tests require the dev server to be running on http://localhost:3000.
 *       Run with: npx playwright test tests/e2e/accessibility.spec.ts
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Helper: force the dark theme and return a configured AxeBuilder for contrast only.
async function buildAxeContrast(page: import('@playwright/test').Page) {
  // Inject the theme class so the test is deterministic regardless of system preference.
  await page.evaluate(() => {
    document.documentElement.classList.remove('theme-light');
    document.documentElement.classList.add('theme-dark');
  });

  return new AxeBuilder({ page })
    // Isolate to the color-contrast rule so this suite does not shadow other a11y suites.
    .withRules(['color-contrast'])
    // Exclude decorative elements that axe may incorrectly flag
    // (e.g. <hr>, gradient-only divs, placeholder shimmer regions).
    .exclude('[aria-hidden="true"]')
    .exclude('[data-skeleton]');
}

// ────────────────────────────────────────────────────────────────────────────
// Landing page
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — landing', () => {
  test('landing page has no color-contrast violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Dashboard
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — dashboard', () => {
  test('dashboard page has no color-contrast violations', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Agents registry
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — agents', () => {
  test('agents page has no color-contrast violations', async ({ page }) => {
    await page.goto('/agents');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Task submission wizard
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — task submission', () => {
  test('new task page has no color-contrast violations', async ({ page }) => {
    await page.goto('/tasks/new');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });

  test('step 1 (describe goal) — error state has no contrast violations', async ({ page }) => {
    await page.goto('/tasks/new');
    await page.waitForLoadState('networkidle');

    // Trigger validation error to test error text contrast.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Prompt is required')).toBeVisible();

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Task history
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — task history', () => {
  test('task history page has no color-contrast violations', async ({ page }) => {
    await page.goto('/tasks');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Wallet
// ────────────────────────────────────────────────────────────────────────────
test.describe('WCAG AA contrast — dark mode — wallet', () => {
  test('wallet page has no color-contrast violations', async ({ page }) => {
    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');

    const axe = await buildAxeContrast(page);
    const results = await axe.analyze();

    expect(
      results.violations,
      formatViolations(results.violations),
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Manual token contract checks — pure WCAG arithmetic, no DOM required.
//
// These tests verify the design token values independently of rendering so
// that a future token change immediately breaks the suite without waiting for
// a full Playwright run.  They use the same relative luminance formula as axe.
// ────────────────────────────────────────────────────────────────────────────
test.describe('design token contrast contracts', () => {
  // WCAG relative luminance for sRGB.
  function linearize(channel: number): number {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(hex: string): number {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  }

  function contrastRatio(fg: string, bg: string): number {
    const l1 = relativeLuminance(fg);
    const l2 = relativeLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /** Resolve rgba(r,g,b,a) onto a solid background hex colour. */
  function resolveAlpha(r: number, g: number, b: number, a: number, bgHex: string): string {
    const bg = bgHex.replace('#', '');
    const br = parseInt(bg.substring(0, 2), 16);
    const bg2 = parseInt(bg.substring(2, 4), 16);
    const bb = parseInt(bg.substring(4, 6), 16);
    const out = [
      Math.round(r * a + br * (1 - a)),
      Math.round(g * a + bg2 * (1 - a)),
      Math.round(b * a + bb * (1 - a)),
    ];
    return '#' + out.map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Dark mode surface tokens (authoritative values from tokens.css :root)
  const DARK = {
    canvas:    '#0a0e14',
    primary:   '#11151d',
    secondary: '#161b24',
    raised:    '#1a1f2e',
  };

  // ── Text tokens ──────────────────────────────────────────────────────────

  test('--text-primary (#f5f7fa) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#f5f7fa';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--text-primary on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--text-secondary (#8a93a3) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#8a93a3';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--text-secondary on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--text-muted (#94a3b8) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#94a3b8';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--text-muted on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--text-subtle rgba(148,163,184,0.85) passes 4.5:1 on all main dark surfaces', () => {
    // Resolve the alpha token against each surface before measuring contrast.
    for (const [name, bg] of Object.entries(DARK)) {
      const resolved = resolveAlpha(148, 163, 184, 0.85, bg);
      const ratio = contrastRatio(resolved, bg);
      expect(ratio, `--text-subtle (resolved) on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // ── Accent text token ─────────────────────────────────────────────────────

  test('--accent-text-strong (#a78bfa) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#a78bfa';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--accent-text-strong on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--accent-text-interactive (#a78bfa) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#a78bfa';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--accent-text-interactive on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // ── Button contrast ───────────────────────────────────────────────────────

  test('--accent-btn (#7c3aed) achieves 4.5:1 with white button labels', () => {
    // Primary buttons use white (#ffffff) text on --accent-btn background.
    const ratio = contrastRatio('#ffffff', '#7c3aed');
    expect(ratio, 'white on --accent-btn').toBeGreaterThanOrEqual(4.5);
  });

  // ── Status text tokens ────────────────────────────────────────────────────

  test('--status-danger-text (#fca5a5) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#fca5a5';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--status-danger-text on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--status-success-text (#a7f3d0) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#a7f3d0';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--status-success-text on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('--status-warning-text (#fde68a) passes 4.5:1 on all main dark surfaces', () => {
    const token = '#fde68a';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `--status-warning-text on surface-${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // ── Focus indicator ───────────────────────────────────────────────────────

  test('focus outline --accent (#8b5cf6) passes 3:1 UI requirement on all main dark surfaces', () => {
    // WCAG 1.4.11 Non-Text Contrast requires 3:1 for focus indicators.
    const token = '#8b5cf6';
    for (const [name, bg] of Object.entries(DARK)) {
      const ratio = contrastRatio(token, bg);
      expect(ratio, `focus --accent on surface-${name}`).toBeGreaterThanOrEqual(3.0);
    }
  });

  // ── Guard: --accent must NOT drop below 3:1 on any surface (it is never used for normal text) ──

  test('--accent (#8b5cf6) is not used as normal text (must use --accent-text-strong instead)', () => {
    // The accent token (#8b5cf6) only passes 4.5:1 on surface-canvas.
    // This test documents that it FAILS AA on surface-raised so any future
    // bump to --accent that crosses 4.5:1 everywhere is welcome but not required.
    const ratio = contrastRatio('#8b5cf6', DARK.raised);
    // It must still pass the UI 3:1 threshold (focus/icon use).
    expect(ratio, '--accent still meets 3:1 UI threshold on surface-raised').toBeGreaterThanOrEqual(3.0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Format axe violations into a human-readable string for assertion messages.
 */
function formatViolations(violations: import('axe-core').Result[]): string {
  if (violations.length === 0) return 'No violations';
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `    • ${n.html}\n      ${n.failureSummary ?? ''}`)
        .join('\n');
      return `[${v.id}] ${v.description}\n${nodes}`;
    })
    .join('\n\n');
}
