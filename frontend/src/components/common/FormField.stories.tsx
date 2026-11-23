import type { Meta, StoryObj } from '@storybook/react';
import { FormField } from './FormField';

const meta: Meta<typeof FormField> = {
  title: 'Common/FormField',
  component: FormField,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Labelled input or textarea with inline validation states (untouched, valid, invalid) and optional helper text.',
      },
    },
  },
  argTypes: {
    as: { control: 'select', options: ['input', 'textarea'] },
    label: { control: 'text' },
    error: { control: 'text' },
    isTouched: { control: 'boolean' },
    helperText: { control: 'text' },
    disabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<typeof FormField>;

export const Default: Story = {
  args: { label: 'Wallet address', name: 'wallet', placeholder: 'G...' },
};

export const WithError: Story = {
  args: {
    label: 'Budget (XLM)',
    name: 'budget',
    value: '-5',
    isTouched: true,
    error: 'Budget must be a positive number',
  },
};

export const Valid: Story = {
  args: {
    label: 'Task prompt',
    name: 'prompt',
    value: 'Analyze the DeFi market in 2025',
    isTouched: true,
  },
};

export const TextareaVariant: Story = {
  args: {
    label: 'Task description',
    name: 'description',
    as: 'textarea',
    placeholder: 'Describe what you need…',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'API key',
    name: 'apikey',
    type: 'password',
    helperText: 'Your key is never stored on our servers.',
  },
};
