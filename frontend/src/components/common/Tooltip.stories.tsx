import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip } from './Tooltip';

const meta: Meta<typeof Tooltip> = {
  title: 'Common/Tooltip',
  component: Tooltip,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Lightweight tooltip wrapper. Hover or focus the trigger to reveal the content.',
      },
    },
  },
  argTypes: {
    content: { control: 'text' },
    placement: { control: 'select', options: ['top', 'bottom'] },
  },
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Top: Story = {
  args: {
    content: 'This is a tooltip',
    placement: 'top',
  },
  render: (args) => (
    <Tooltip {...args}>
      <button style={{ padding: '0.5rem 1rem', background: '#334155', color: '#f1f5f9', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
        Hover me
      </button>
    </Tooltip>
  ),
};

export const Bottom: Story = {
  args: {
    content: 'Tooltip below',
    placement: 'bottom',
  },
  render: (args) => (
    <Tooltip {...args}>
      <button style={{ padding: '0.5rem 1rem', background: '#334155', color: '#f1f5f9', borderRadius: '0.5rem', border: 'none', cursor: 'pointer' }}>
        Hover me
      </button>
    </Tooltip>
  ),
};

export const LongContent: Story = {
  args: {
    content: 'This tooltip has longer descriptive content to describe the concept.',
    placement: 'top',
  },
  render: (args) => (
    <Tooltip {...args}>
      <span style={{ color: '#94a3b8', textDecoration: 'underline dotted', cursor: 'help' }}>
        What is XLM?
      </span>
    </Tooltip>
  ),
};
