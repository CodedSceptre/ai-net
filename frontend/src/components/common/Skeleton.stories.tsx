import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton, SkeletonText, SkeletonCard, SkeletonAvatar, SkeletonTable } from './Skeleton';

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
};
