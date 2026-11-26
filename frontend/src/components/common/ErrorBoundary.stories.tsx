import type { Meta, StoryObj } from '@storybook/react';
import { ErrorBoundary } from './ErrorBoundary';

const meta: Meta<typeof ErrorBoundary> = {
  title: 'Common/ErrorBoundary',
  component: ErrorBoundary,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Class-based error boundary. Catches render errors from children and renders a fallback error screen with a retry action.',
      },
    },
  },
  argTypes: {
    label: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorBoundary>;

const GoodChild = () => (
  <div style={{ padding: '2rem', color: '#a7f3d0' }}>Children rendered successfully.</div>
);

const BrokenChild = () => {
  throw new Error('Intentional render error for story');
};

export const WithHealthyChild: Story = {
  args: { label: 'Demo section' },
  render: (args) => (
    <ErrorBoundary {...args}>
      <GoodChild />
    </ErrorBoundary>
  ),
};

export const WithBrokenChild: Story = {
  args: { label: 'Broken section' },
  render: (args) => (
    <ErrorBoundary {...args}>
      <BrokenChild />
    </ErrorBoundary>
  ),
};

export const NestedBoundaries: Story = {
  render: () => (
    <ErrorBoundary label="outer">
      <div style={{ padding: '1rem', border: '1px solid #334155', borderRadius: '0.5rem' }}>
        <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>Outer boundary is healthy.</p>
        <ErrorBoundary label="inner widget">
          <BrokenChild />
        </ErrorBoundary>
      </div>
    </ErrorBoundary>
  ),
};
