import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { TaskTimeline } from './TaskTimeline';
import type { TaskResponse } from '../../types/api';

const completedTask: TaskResponse = {
  taskId: 'task-story-001',
  prompt: 'Research and analyze the solar energy market in Southeast Asia',
  walletPublicKey: 'GBXV37U3P5SIH46YI77XQ6WPAUXF3C2EDTYO54PBYU11A7T5F2TY4S25',
  status: 'completed',
  createdAt: new Date(Date.now() - 120_000).toISOString(),
  updatedAt: new Date().toISOString(),
  dag: [
    { nodeId: 'node-research', agentType: 'research', prompt: 'Gather market data', dependsOn: [], status: 'completed' },
    { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess regulatory risk', dependsOn: ['node-research'], status: 'completed' },
    { nodeId: 'node-report', agentType: 'report', prompt: 'Compile final report', dependsOn: ['node-risk'], status: 'completed' },
  ],
};

const runningTask: TaskResponse = {
  ...completedTask,
  taskId: 'task-story-002',
  status: 'running',
  dag: [
    { nodeId: 'node-research', agentType: 'research', prompt: 'Gather market data', dependsOn: [], status: 'completed' },
    { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess regulatory risk', dependsOn: ['node-research'], status: 'running' },
    { nodeId: 'node-report', agentType: 'report', prompt: 'Compile final report', dependsOn: ['node-risk'], status: 'pending' },
  ],
};

const failedTask: TaskResponse = {
  ...completedTask,
  taskId: 'task-story-003',
  status: 'failed',
  dag: [
    { nodeId: 'node-research', agentType: 'research', prompt: 'Gather market data', dependsOn: [], status: 'completed' },
    { nodeId: 'node-risk', agentType: 'risk', prompt: 'Assess regulatory risk', dependsOn: ['node-research'], status: 'failed', error: 'Upstream timeout' },
    { nodeId: 'node-report', agentType: 'report', prompt: 'Compile final report', dependsOn: ['node-risk'], status: 'pending' },
  ],
};

const meta: Meta<typeof TaskTimeline> = {
  title: 'Tasks/TaskTimeline',
  component: TaskTimeline,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Timeline view of tasks and their DAG nodes, showing per-node status, duration, and cost. Supports comparison selection mode.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof TaskTimeline>;

export const WithCompletedTask: Story = {
  args: {
    tasks: [completedTask],
    loading: false,
    selectedIds: [null, null],
    onToggleSelect: () => {},
    isComparing: false,
    hasFilters: false,
  },
};

export const WithRunningTask: Story = {
  args: {
    tasks: [runningTask],
    loading: false,
    selectedIds: [null, null],
    onToggleSelect: () => {},
    isComparing: false,
    hasFilters: false,
  },
};

export const WithFailedTask: Story = {
  args: {
    tasks: [failedTask],
    loading: false,
    selectedIds: [null, null],
    onToggleSelect: () => {},
    isComparing: false,
    hasFilters: false,
  },
};

export const Loading: Story = {
  args: {
    tasks: [],
    loading: true,
    selectedIds: [null, null],
    onToggleSelect: () => {},
    isComparing: false,
    hasFilters: false,
  },
};

export const ComparingMode: Story = {
  render: () => {
    const Wrapper = () => {
      const [selectedIds, setSelectedIds] = useState<[string | null, string | null]>([
        'task-story-001',
        'task-story-003',
      ]);
      const toggle = (id: string) => {
        setSelectedIds((prev) => {
          const [a, b] = prev;
          if (a === id) return [b, null];
          if (b === id) return [a, null];
          if (!a) return [id, b];
          return [a, id];
        });
      };
      return (
        <TaskTimeline
          tasks={[completedTask, failedTask]}
          loading={false}
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          isComparing={selectedIds[0] !== null && selectedIds[1] !== null}
          hasFilters={false}
        />
      );
    };
    return <Wrapper />;
  },
};
