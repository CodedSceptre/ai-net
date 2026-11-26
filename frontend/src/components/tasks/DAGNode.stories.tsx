import type { Meta, StoryObj } from '@storybook/react';
import { DAGNode } from './DAGNode';

const meta: Meta<typeof DAGNode> = {
  title: 'Tasks/DAGNode',
  component: DAGNode,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Per-capability animated node for the DAG execution visualizer. Each agent type has a distinct CSS-only animation. All animations respect prefers-reduced-motion.',
      },
    },
  },
  argTypes: {
    agentType: {
      control: 'select',
      options: ['research', 'coding', 'risk', 'design', 'report'],
    },
    status: {
      control: 'select',
      options: ['pending', 'running', 'completed', 'failed'],
    },
    isSelected: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof DAGNode>;

const base = { nodeId: 'node-1', isSelected: false };

export const ResearchRunning: Story = {
  args: { ...base, agentType: 'research', label: 'Research Agent', status: 'running' },
};

export const CodingRunning: Story = {
  args: { ...base, agentType: 'coding', label: 'Coding Agent', status: 'running' },
};

export const RiskRunning: Story = {
  args: { ...base, agentType: 'risk', label: 'Risk Agent', status: 'running' },
};

export const DesignRunning: Story = {
  args: { ...base, agentType: 'design', label: 'Design Agent', status: 'running' },
};

export const ReportRunning: Story = {
  args: { ...base, agentType: 'report', label: 'Report Agent', status: 'running' },
};

export const CompletedBurst: Story = {
  args: { ...base, agentType: 'research', label: 'Research Agent', status: 'completed' },
};

export const FailedShake: Story = {
  args: { ...base, agentType: 'coding', label: 'Coding Agent', status: 'failed' },
};

export const Queued: Story = {
  args: { ...base, agentType: 'risk', label: 'Risk Agent', status: 'pending' },
};

export const AllAgentTypesRunning: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      {(['research', 'coding', 'risk', 'design', 'report'] as const).map((type) => (
        <DAGNode
          key={type}
          nodeId={`node-${type}`}
          agentType={type}
          label={`${type.charAt(0).toUpperCase() + type.slice(1)} Agent`}
          status="running"
        />
      ))}
    </div>
  ),
};
