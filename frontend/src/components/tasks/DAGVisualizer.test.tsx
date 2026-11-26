import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  DAGVisualizer,
  DAGCustomNode,
  STATUS_COLORS,
  STATUS_BG,
  type DAGNodeData,
  type NodeStatus,
} from './DAGVisualizer';
import type { Node, Edge } from 'reactflow';

// Mock reactflow components since canvas/SVG layout doesn't run in jsdom
vi.mock('reactflow', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('reactflow');
  return {
    ...actual,
    default: ({ children, nodes }: { children: React.ReactNode; nodes: Node[] }) => (
      <div data-testid="react-flow-mock">
        {nodes.map((n) => (
          <div key={n.id} data-testid={`node-${n.id}`}>
            {n.data?.label}
          </div>
        ))}
        {children}
      </div>
    ),
    Controls: () => <div data-testid="controls-mock" />,
    MiniMap: ({ nodeColor }: { nodeColor?: (n: Node<DAGNodeData>) => string }) => {
      // Execute nodeColor for test assertion
      const mockNode: Node<DAGNodeData> = {
        id: 'test',
        position: { x: 0, y: 0 },
        data: { label: 'test', status: 'running' },
      };
      const color = nodeColor ? nodeColor(mockNode) : '';
      return <div data-testid="minimap-mock" data-resolved-color={color} />;
    },
    Background: () => <div data-testid="background-mock" />,
    Handle: () => <div data-testid="handle-mock" />,
  };
});

describe('DAGVisualizer & STATUS_COLORS', () => {
  it('correctly maps status values to specific hex colors', () => {
    expect(STATUS_COLORS.pending).toBe('#6B7280');
    expect(STATUS_COLORS.running).toBe('#3B82F6');
    expect(STATUS_COLORS.completed).toBe('#10B981');
    expect(STATUS_COLORS.failed).toBe('#EF4444');
  });

  it('renders DAGCustomNode with appropriate styles and border colors per status', () => {
    const statuses: NodeStatus[] = ['pending', 'running', 'completed', 'failed'];

    statuses.forEach((status) => {
      const { unmount } = render(
        <DAGCustomNode
          id={`node-${status}`}
          data={{
            label: `Task ${status}`,
            status,
            capability: 'analysis',
          }}
          type="dagNode"
          selected={false}
          zIndex={1}
          isConnectable={false}
          xPos={0}
          yPos={0}
          dragging={false}
        />
      );

      const nodeElement = screen.getByTestId('dag-custom-node');
      expect(nodeElement).toBeDefined();
      expect(nodeElement.getAttribute('data-status')).toBe(status);
      expect(nodeElement.style.border).toContain(STATUS_COLORS[status]);
      expect(screen.getByText(`Task ${status}`)).toBeDefined();

      unmount();
    });
  });

  it('renders DAGVisualizer with nodes, edges, controls and minimap', () => {
    const mockNodes: Node<DAGNodeData>[] = [
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        data: { label: 'Node 1', status: 'completed' },
      },
      {
        id: 'node-2',
        position: { x: 200, y: 0 },
        data: { label: 'Node 2', status: 'running' },
      },
    ];

    const mockEdges: Edge[] = [
      {
        id: 'e1-2',
        source: 'node-1',
        target: 'node-2',
      },
    ];

    render(<DAGVisualizer nodes={mockNodes} edges={mockEdges} />);

    expect(screen.getByTestId('react-flow-mock')).toBeDefined();
    expect(screen.getByTestId('controls-mock')).toBeDefined();
    const minimap = screen.getByTestId('minimap-mock');
    expect(minimap).toBeDefined();
    expect(minimap.getAttribute('data-resolved-color')).toBe(STATUS_COLORS.running);
  });
});
