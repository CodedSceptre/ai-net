import type { Meta, StoryObj } from '@storybook/react';
import { CopyButton } from './CopyButton';

const meta: Meta<typeof CopyButton> = {
  title: 'Common/CopyButton',
  component: CopyButton,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'One-click copy-to-clipboard button. Shows a "Copied!" confirmation state briefly after the user clicks.',
      },
    },
  },
  argTypes: {
    text: { control: 'text' },
    label: { control: 'text' },
    copiedLabel: { control: 'text' },
    iconSize: { control: 'number' },
  },
};

export default meta;
type Story = StoryObj<typeof CopyButton>;

export const Default: Story = {
  args: {
    text: 'GBXV37U3P5SIH46YI77XQ6WPAUXF3C2EDTYO54PBYU11A7T5F2TY4S25',
    label: 'Copy address',
  },
};

export const CustomLabels: Story = {
  args: {
    text: 'secret-value',
    label: 'Copy secret',
    copiedLabel: '✓ Done',
  },
};

export const LargeIcon: Story = {
  args: {
    text: 'some-value',
    iconSize: 20,
  },
};
