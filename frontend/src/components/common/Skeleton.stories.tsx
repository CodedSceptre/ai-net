import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonAvatar, SkeletonTable } from './Skeleton';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonAvatar } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'Common/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof Skeleton>;

export const Text: Story = {
  args: { variant: 'text', width: '200px', height: '1rem' },
};

export const Circle: Story = {
  args: { variant: 'circle', width: 48, height: 48 },
};

export const Rect: Story = {
  args: { variant: 'rect', width: '300px', height: '100px' },
};

export const TextBlock: StoryObj = {
  render: () => <SkeletonText lines={4} />,
};

export const CardExample: StoryObj = {
  render: () => (
    <SkeletonCard style={{ padding: '1rem', maxWidth: 320 }}>
      <SkeletonAvatar size={40} />
      <SkeletonText lines={2} style={{ marginTop: '0.5rem' }} />
    </SkeletonCard>
  ),
};

export const TableExample: StoryObj = {
  render: () => <SkeletonTable rows={5} columns={4} />,
};

export const NoAnimation: Story = {
  args: { variant: 'rect', width: '200px', height: '80px', animate: false },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Loading skeleton primitives. Use Skeleton for single blocks, SkeletonText for multi-line prose, SkeletonCard for card shells, and SkeletonAvatar for circular avatars.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['text', 'circle', 'rect', 'card', 'pill', 'circular', 'rectangular'],
    },
    animate: { control: 'boolean' },
    width: { control: 'text' },
    height: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Text: Story = {
  args: { variant: 'text', width: '200px', height: '1rem', animate: true },
};

export const Circular: Story = {
  args: { variant: 'circular', width: '48px', height: '48px', animate: true },
};

export const Pill: Story = {
  args: { variant: 'pill', width: '80px', height: '1.5rem', animate: true },
};

export const Rectangular: Story = {
  args: { variant: 'rectangular', width: '300px', height: '120px', animate: true },
};

export const TextBlock: Story = {
  render: () => (
    <div style={{ width: '320px' }}>
      <SkeletonText lines={4} />
    </div>
  ),
};

export const CardShell: Story = {
  render: () => (
    <div style={{ width: '320px' }}>
      <SkeletonCard>
        <SkeletonAvatar size={48} />
        <SkeletonText lines={3} />
      </SkeletonCard>
    </div>
  ),
};

export const StaticNoAnimation: Story = {
  args: { variant: 'text', width: '200px', height: '1rem', animate: false },
};
