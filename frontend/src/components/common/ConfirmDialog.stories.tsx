import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ConfirmDialog } from './ConfirmDialog';

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Common/ConfirmDialog',
  component: ConfirmDialog,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Accessible confirmation dialog for destructive actions. Focus is trapped inside; Escape dismisses; Enter does not confirm (safe default).',
      },
    },
  },
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    consequence: { control: 'text' },
    confirmLabel: { control: 'text' },
    cancelLabel: { control: 'text' },
    onConfirm: { action: 'confirmed' },
    onCancel: { action: 'cancelled' },
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

export const Default: Story = {
  args: {
    open: true,
    title: 'Delete task',
    description: 'Are you sure you want to delete this task? This action cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm: () => {},
    onCancel: () => {},
  },
};

export const WithConsequence: Story = {
  args: {
    open: true,
    title: 'Disconnect Wallet',
    description: 'You are about to disconnect your Stellar wallet from ai-net.',
    consequence: 'All pending task payments will be cancelled and cannot be recovered.',
    confirmLabel: 'Disconnect',
    cancelLabel: 'Keep Connected',
    onConfirm: () => {},
    onCancel: () => {},
  },
};

export const Interactive: Story = {
  render: () => {
    const Wrapper = () => {
      const [open, setOpen] = useState(false);
      const [result, setResult] = useState<string | null>(null);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => setOpen(true)}
            style={{ padding: '0.5rem 1.25rem', background: '#ef4444', color: '#fff', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}
          >
            Open Dialog
          </button>
          {result && <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>Result: {result}</p>}
          <ConfirmDialog
            open={open}
            title="Confirm action"
            description="This will permanently remove the item."
            confirmLabel="Confirm"
            onConfirm={() => { setResult('confirmed'); setOpen(false); }}
            onCancel={() => { setResult('cancelled'); setOpen(false); }}
          />
        </div>
      );
    };
    return <Wrapper />;
  },
};
