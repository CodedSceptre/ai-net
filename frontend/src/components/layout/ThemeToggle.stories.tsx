/**
 * ThemeToggle.stories.tsx
 *
 * Storybook stories for the ThemeToggle button (issue #739).
 * Shows the button in both dark and light states.
 *
 * NOTE: Storybook is not yet installed (@storybook/* packages absent from
 * frontend/package.json). This file is a ready-to-use stub — run
 *   npx storybook@latest init   # inside frontend/
 * to activate it.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '../../context/ThemeContext';

/** Wrap each story in ThemeProvider so useTheme() resolves correctly. */
const withThemeProvider = (Story: React.ComponentType) => (
  <ThemeProvider>
    <div style={{ padding: 24 }}>
      <Story />
    </div>
  </ThemeProvider>
);

const meta: Meta<typeof ThemeToggle> = {
  title: 'Layout/ThemeToggle',
  component: ThemeToggle,
  decorators: [withThemeProvider],
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof ThemeToggle>;

export const DarkMode: Story = {
  name: 'Dark mode (moon icon)',
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('theme-dark');
      document.documentElement.classList.remove('theme-light');
      return (
        <ThemeProvider>
          <div style={{ padding: 24, background: '#0a0e14' }}>
            <Story />
          </div>
        </ThemeProvider>
      );
    },
  ],
};

export const LightMode: Story = {
  name: 'Light mode (sun icon)',
  decorators: [
    (Story) => {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.add('theme-light');
      document.documentElement.classList.remove('theme-dark');
      return (
        <ThemeProvider>
          <div style={{ padding: 24, background: '#ffffff' }}>
            <Story />
          </div>
        </ThemeProvider>
      );
    },
  ],
};
