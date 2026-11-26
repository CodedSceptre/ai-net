/**
 * TaskMilestoneTimeline.stories.tsx
 *
 * Storybook stories for TaskMilestoneTimeline.
 * Three states: in-progress, completed, and failed.
 *
 * NOTE: Storybook is not yet installed (@storybook/* absent from
 * frontend/package.json). This file is a ready-to-use stub — run
 *   npx storybook@latest init   # inside frontend/
 * to activate it.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { TaskMilestoneTimeline } from './TaskMilestoneTimeline';
import type { TaskResponse, DAGNode, PaymentEvent } from '../../types/api';

const baseTask: TaskResponse = {
  taskId: 'task-story-001',
  prompt: 'Analyse quarterly revenue trends and produce a risk report.',
  walletPublicKey: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGW2Z',
  status: 'running',
  dag: [],
  createdAt: new Date(Date.now() - 120_000).toISOString(),
  updatedAt: new Date().toISOString(),
};

const makeNodes = (statuses: DAGNode['status'][]): DAGNode[] =>
  statuses.map((status, i) => ({
    nodeId: `node_${i}`,
    agentType: ['research', 'risk', 'coding', 'design', 'report'][i % 5],
    prompt: `Step ${i + 1}`,
    dependsOn: i === 0 ? [] : [`node_${i - 1}`],
    status,
    startedAt: new Date(Date.now() - (statuses.length - i) * 20_000).toISOString(),
    completedAt:
      status === 'completed'
        ? new Date(Date.now() - (statuses.length - i - 1) * 20_000).toISOString()
        : undefined,
  }));

const noPayments: PaymentEvent[] = [];

const payments: PaymentEvent[] = [
  {
    amount: '0.5',
    direction: 'out',
    counterparty: 'GAGENT1',
    timestamp: new Date(Date.now() - 5_000).toISOString(),
    txHash: 'abc123',
  },
];

// ─── Meta ─────────────────────────────────────────────────────────────────────

const meta: Meta<typeof TaskMilestoneTimeline> = {
  title: 'Tasks/TaskMilestoneTimeline',
  component: TaskMilestoneTimeline,
  parameters: {
    layout: 'padded',
  },
  argTypes: {},
};

export default meta;
type Story = StoryObj<typeof TaskMilestoneTimeline>;

// ─── Stories ──────────────────────────────────────────────────────────────────

export const InProgress: Story = {
  name: 'In Progress',
  args: {
    task: { ...baseTask, status: 'running' },
    nodes: makeNodes(['completed', 'completed', 'running', 'pending', 'pending']),
    payments: noPayments,
  },
};

export const Completed: Story = {
  name: 'Completed',
  args: {
    task: {
      ...baseTask,
      status: 'completed',
      updatedAt: new Date(Date.now() - 10_000).toISOString(),
    },
    nodes: makeNodes(['completed', 'completed', 'completed', 'completed', 'completed']),
    payments,
  },
};

export const Failed: Story = {
  name: 'Failed',
  args: {
    task: {
      ...baseTask,
      status: 'failed',
      updatedAt: new Date(Date.now() - 30_000).toISOString(),
    },
    nodes: makeNodes(['completed', 'completed', 'failed', 'pending', 'pending']),
    payments: noPayments,
  },
};
