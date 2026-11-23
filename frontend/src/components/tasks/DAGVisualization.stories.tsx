import type { Meta, StoryObj } from '@storybook/react';
import { DAGVisualization } from './DAGVisualization';
import type { DAGNode } from '../../types/api';

const threeNodeDAG: DAGNode[] = [
  { nodeId: 'node-research', agentType: 'research', prompt: 'Gather market data', dependsOn: [], status: 'completed' },
  { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess regulatory risk', dependsOn: ['node-research'], status: 'running' },
  { nodeId: 'node-report', agentType: 'report', prompt: 'Compile final report', dependsOn: ['node-risk'], status: 'pending' },
];

const fiveNodeDAG: DAGNode[] = [
  { nodeId: 'node-research', agentType: 'research', prompt: 'Gather data', dependsOn: [], status: 'completed' },
  { nodeId: 'node-coding', agentType: 'coding', prompt: 'Write code', dependsOn: ['node-research'], status: 'completed' },
  { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess risk', dependsOn: ['node-research'], status: 'running' },
  { nodeId: 'node-design', agentType: 'design', prompt: 'Create designs', dependsOn: ['node-coding'], status: 'pending' },
  { nodeId: 'node-report', agentType: 'report', prompt: 'Write report', dependsOn: ['node-risk', 'node-design'], status: 'pending' },
];

const failedDAG: DAGNode[] = [
  { nodeId: 'node-research', agentType: 'research', prompt: 'Gather data', dependsOn: [], status: 'completed' },
  { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess risk', dependsOn: ['node-research'], status: 'failed', error: 'Service unavailable' },
  { nodeId: 'node-report', agentType: 'report', prompt: 'Write report', dependsOn: ['node-risk'], status: 'pending' },
];

const meta: Meta<typeof DAGVisualization> = {
  title: 'Tasks/DAGVisualization',
  component: DAGVisualization,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Interactive ReactFlow DAG visualizer for task execution graphs. Click a node to open the detail side panel.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DAGVisualization>;

export const ThreeNodes: Story = {
  args: { nodes: threeNodeDAG },
  decorators: [
    (Story) => (
      <div style={{ height: '500px' }}>
        <Story />
      </div>
    ),
  ],
};

export const FiveNodesComplex: Story = {
  args: { nodes: fiveNodeDAG },
  decorators: [
    (Story) => (
      <div style={{ height: '500px' }}>
        <Story />
      </div>
    ),
  ],
};

export const WithFailedNode: Story = {
  args: { nodes: failedDAG },
  decorators: [
    (Story) => (
      <div style={{ height: '500px' }}>
        <Story />
      </div>
    ),
  ],
};

export const Empty: Story = {
  args: { nodes: [] },
  decorators: [
    (Story) => (
      <div style={{ height: '300px' }}>
        <Story />
      </div>
    ),
  ],
};
