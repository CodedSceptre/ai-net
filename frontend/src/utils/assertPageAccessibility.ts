import { configureAxe } from 'jest-axe';
import { expect } from 'vitest';

const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
});

export async function assertPageAccessibility(container: HTMLElement): Promise<void> {
  const results = await axe(container);
  const violations = results.violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  );
  expect(violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })))
    .toEqual([]);
}
