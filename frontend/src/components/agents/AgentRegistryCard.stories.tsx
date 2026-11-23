import type { Meta, StoryObj } from '@storybook/react';
import { AgentRegistryCard } from './AgentRegistryCard';
import type { AgentRecord } from '../../types/api';

const baseAgent: AgentRecord = {
  id: 'agent-001',
  name: 'Atlas Research',
  capabilities: ['research', 'report'],
  price: 0.5,
  reputation: 4.8,
  status: 'active',
};

const meta: Meta<typeof AgentRegistryCard> = {
  title: 'Agents/AgentRegistryCard',
  component: AgentRegistryCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Registry card for a single agent. Shows name, capabilities, price in XLM, reputation stars, and online/offline status.',
      },
    },
  },
  argTypes: {
    onHire: { action: 'hired' },
    onCompare: { action: 'compared' },
    isSelectedForComparison: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof AgentRegistryCard>;

export const Active: Story = {
  args: { agent: baseAgent },
};

export const Inactive: Story = {
  args: { agent: { ...baseAgent, status: 'inactive', name: 'Idle Coder', capabilities: ['coding'] } },
};

export const HighReputation: Story = {
  args: { agent: { ...baseAgent, reputation: 5, name: 'Elite Analyst', price: 1.2 } },
};

export const SelectedForComparison: Story = {
  args: { agent: baseAgent, isSelectedForComparison: true },
};

export const ManyCapabilities: Story = {
  args: {
    agent: {
      ...baseAgent,
      name: 'Generalist Agent',
      capabilities: ['research', 'risk', 'coding', 'design', 'report', 'audit'],
    },
  },
};
