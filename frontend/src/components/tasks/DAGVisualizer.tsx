import React, { useState, useCallback, memo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DAGNodeData {
  label: string;
  status: NodeStatus;
  agentId?: string;
  startTime?: string;
  outputSummary?: string;
  capability?: string;
}

export interface DAGVisualizerProps {
  nodes: Node<DAGNodeData>[];
  edges: Edge[];
  onNodeClick?: (nodeId: string, data: DAGNodeData) => void;
}

export const STATUS_COLORS: Record<NodeStatus, string> = {
  pending: '#6B7280',
  running: '#3B82F6',
  completed: '#10B981',
  failed: '#EF4444',
};

export const STATUS_BG: Record<NodeStatus, string> = {
  pending: 'rgba(107,114,128,0.15)',
  running: 'rgba(59,130,246,0.15)',
  completed: 'rgba(16,185,129,0.15)',
  failed: 'rgba(239,68,68,0.15)',
};

// Custom node component
export const DAGCustomNode = memo(({ data }: NodeProps<DAGNodeData>) => {
  const color = STATUS_COLORS[data.status] ?? STATUS_COLORS.pending;
  const bg = STATUS_BG[data.status] ?? STATUS_BG.pending;

  return (
    <div
      data-testid="dag-custom-node"
      data-status={data.status}
      style={{
        background: bg,
        border: `2px solid ${color}`,
        borderRadius: 12,
        padding: '10px 14px',
        minWidth: 160,
        textAlign: 'center',
        color: 'var(--text-primary, #fff)',
        position: 'relative',
        transition: 'box-shadow 0.3s ease',
        boxShadow: data.status === 'running' ? `0 0 12px ${color}` : 'none',
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: color, width: 8, height: 8 }}
      />

      {data.capability && (
        <div style={{
          fontSize: '9px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color,
          marginBottom: 4,
          opacity: 0.8,
        }}>
          {data.capability}
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
        {data.label}
      </div>

      <div style={{
        display: 'inline-block',
        fontSize: 9,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        background: 'rgba(0,0,0,0.3)',
        color,
        borderRadius: 4,
        padding: '2px 6px',
      }}>
        {data.status}
        {data.status === 'running' && (
          <span style={{ marginLeft: 4, animation: 'pulse 1.5s infinite' }}>●</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: color, width: 8, height: 8 }}
      />
    </div>
  );
});

DAGCustomNode.displayName = 'DAGCustomNode';

const nodeTypes = { dagNode: DAGCustomNode };

interface NodeDetailPanelProps {
  nodeId: string;
  data: DAGNodeData;
  onClose: () => void;
}

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ nodeId, data, onClose }) => (
  <div
    style={{
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 10,
      background: 'var(--surface-panel, #1a1a2e)',
      border: '1px solid var(--border-strong, rgba(255,255,255,0.1))',
      borderRadius: 12,
      padding: 16,
      minWidth: 220,
      maxWidth: 280,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    }}
    data-testid="node-detail-panel"
  >
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>Node Detail</h4>
      <button
        onClick={onClose}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: 16 }}
        aria-label="Close node detail"
      >
        ×
      </button>
    </div>
    <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary, #aaa)' }}>
      <div><strong style={{ color: 'var(--text-primary, #fff)' }}>Agent ID:</strong> {nodeId}</div>
      {data.startTime && (
        <div><strong style={{ color: 'var(--text-primary, #fff)' }}>Start Time:</strong>{' '}
          {new Date(data.startTime).toLocaleTimeString()}
        </div>
      )}
      <div>
        <strong style={{ color: 'var(--text-primary, #fff)' }}>Status:</strong>{' '}
        <span style={{ color: STATUS_COLORS[data.status] ?? STATUS_COLORS.pending, fontWeight: 700, textTransform: 'capitalize' }}>
          {data.status}
        </span>
      </div>
      {data.outputSummary && (
        <div style={{ marginTop: 8 }}>
          <strong style={{ color: 'var(--text-primary, #fff)' }}>Output:</strong>
          <p style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.85, wordBreak: 'break-word' }}>
            {data.outputSummary}
          </p>
        </div>
      )}
    </div>
  </div>
);

export const DAGVisualizer: React.FC<DAGVisualizerProps> = ({ nodes, edges, onNodeClick }) => {
  const [selectedNode, setSelectedNode] = useState<{ id: string; data: DAGNodeData } | null>(null);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node<DAGNodeData>) => {
    setSelectedNode({ id: node.id, data: node.data });
    onNodeClick?.(node.id, node.data);
  }, [onNodeClick]);

  // Style edges: animated dash for running targets
  const styledEdges: Edge[] = edges.map(edge => {
    const targetNode = nodes.find(n => n.id === edge.target);
    const isRunning = targetNode?.data?.status === 'running';
    const isCompleted = targetNode?.data?.status === 'completed';
    const isFailed = targetNode?.data?.status === 'failed';

    let strokeColor = '#6B7280';
    if (isCompleted) strokeColor = '#10B981';
    else if (isRunning) strokeColor = '#3B82F6';
    else if (isFailed) strokeColor = '#EF4444';

    return {
      ...edge,
      animated: isRunning,
      style: { stroke: strokeColor, strokeWidth: 2.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor },
    };
  });

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable={false}
        nodesDraggable={false}
        attributionPosition="bottom-left"
        data-testid="dag-visualizer"
      >
        <Background color="rgba(255,255,255,0.03)" gap={16} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(node: Node<DAGNodeData>) => STATUS_COLORS[node.data?.status] ?? STATUS_COLORS.pending}
          maskColor="rgba(0,0,0,0.6)"
          style={{ background: 'var(--surface-panel, #111)' }}
        />
      </ReactFlow>

      {selectedNode && (
        <NodeDetailPanel
          nodeId={selectedNode.id}
          data={selectedNode.data}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
};

export default DAGVisualizer;
