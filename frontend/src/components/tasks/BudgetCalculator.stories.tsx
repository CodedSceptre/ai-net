import type { Meta, StoryObj } from '@storybook/react';
import { BudgetCalculator } from './BudgetCalculator';

const meta: Meta<typeof BudgetCalculator> = {
  title: 'Tasks/BudgetCalculator',
  component: BudgetCalculator,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Interactive XLM budget calculator. Enter a task prompt to get a real-time per-node cost estimate with a 10% buffer, USD equivalent, and a budget slider.',
      },
    },
  },
  argTypes: {
    initialPrompt: { control: 'text' },
    onLockBudget: { action: 'lockBudget' },
  },
};

export default meta;
type Story = StoryObj<typeof BudgetCalculator>;

export const Empty: Story = {
  args: { initialPrompt: '' },
};

export const WithPrompt: Story = {
  args: {
    initialPrompt: 'Research and analyze the solar energy market in Southeast Asia',
  },
};

export const ComplexTask: Story = {
  args: {
    initialPrompt:
      'Research competitor landscape, assess risk of regulatory changes, write coding specs, design UI mockups, and produce a final report',
  },
};

export const OnLockBudget: Story = {
  args: {
    initialPrompt: 'Generate a risk report for my DeFi protocol',
    onLockBudget: (values) => {
      console.log('Locked budget:', values);
    },
  },
};
