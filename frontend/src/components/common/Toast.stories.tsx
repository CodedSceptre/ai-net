/**
 * Toast.stories.tsx
 *
 * Storybook stories for the Toast notification system (issue #736).
 * Shows all 4 variants (success, error, warning, info) with controls.
 *
 * NOTE: Storybook is not yet installed (@storybook/* packages absent from
 * frontend/package.json). This file is a ready-to-use stub — run
 *   npx storybook@latest init   # inside frontend/
 * to activate it.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ToastContainer } from './Toast';
import type { Toast } from '../../context/ToastContext';

const makeToast = (overrides: Partial<Toast>): Toast => ({
  id: Math.random().toString(36).slice(2),
  message: 'Something happened.',
  type: 'info',
  duration: 4000,
  count: 1,
  createdAt: Date.now(),
  ...overrides,
});

const meta: Meta<typeof ToastContainer> = {
  title: 'Common/Toast',
  component: ToastContainer,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    toasts: { control: false },
  },
};

export default meta;
type Story = StoryObj<typeof ToastContainer>;

const noop = () => {};

export const Success: Story = {
  name: 'Success',
  args: {
    toasts: [
      makeToast({
        type: 'success',
        message: 'Task submitted successfully.',
      }),
    ],
    onDismiss: noop,
  },
};

export const Error: Story = {
  name: 'Error',
  args: {
    toasts: [
      makeToast({
        type: 'error',
        message: 'Payment failed. Please retry.',
        duration: 8000,
      }),
    ],
    onDismiss: noop,
  },
};

export const Warning: Story = {
  name: 'Warning',
  args: {
    toasts: [
      makeToast({
        type: 'warning',
        message: 'Rate limit reached. Slow down requests.',
        duration: 8000,
      }),
    ],
    onDismiss: noop,
  },
};

export const Info: Story = {
  name: 'Info',
  args: {
    toasts: [
      makeToast({
        type: 'info',
        message: 'A new agent joined the registry.',
      }),
    ],
    onDismiss: noop,
  },
};

export const AllVariants: Story = {
  name: 'All variants (max 3 visible)',
  args: {
    toasts: [
      makeToast({ type: 'success', message: 'Task completed.' }),
      makeToast({ type: 'warning', message: 'Budget threshold reached.', duration: 8000 }),
      makeToast({ type: 'error', message: 'Agent unreachable.', duration: 8000 }),
    ],
    onDismiss: noop,
  },
};

export const WithAction: Story = {
  name: 'With action button',
  args: {
    toasts: [
      makeToast({
        type: 'error',
        message: 'Failed to submit task.',
        duration: 8000,
        action: { label: 'Retry', onClick: () => alert('Retrying…') },
      }),
    ],
    onDismiss: noop,
  },
};

export const DuplicateGrouped: Story = {
  name: 'Grouped duplicates (×3)',
  args: {
    toasts: [
      makeToast({ type: 'info', message: 'WebSocket reconnecting.', count: 3 }),
    ],
    onDismiss: noop,
  },
};
