import type { Meta, StoryObj } from '@storybook/react';
import { Search, Inbox, AlertCircle } from 'lucide-react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Common/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Generic empty-state placeholder with optional icon, illustration, primary/secondary actions, and three layout variants.',
      },
    },
  },
  argTypes: {
    variant: { control: 'select', options: ['default', 'card', 'compact'] },
    title: { control: 'text' },
    description: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    title: 'No tasks yet',
    description: 'Submit your first task to get started with ai-net.',
    icon: <Inbox size={32} />,
    primaryAction: { label: 'New Task' },
  },
};

export const WithSecondaryAction: Story = {
  args: {
    title: 'No results found',
    description: 'Try adjusting your search filters.',
    icon: <Search size={32} />,
    primaryAction: { label: 'Clear Filters' },
    secondaryAction: { label: 'Browse All' },
  },
};

export const CardVariant: Story = {
  args: {
    title: 'No agents available',
    description: 'All agents are currently offline.',
    icon: <AlertCircle size={32} />,
    variant: 'card',
  },
};

export const CompactVariant: Story = {
  args: {
    title: 'No data',
    variant: 'compact',
  },
};

export const NoActions: Story = {
  args: {
    title: 'Nothing here',
    description: 'Check back later.',
    icon: <Inbox size={28} />,
  },
};
