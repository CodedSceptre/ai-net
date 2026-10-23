import { useEffect, useState } from "react";
import type { FC } from "react";
import { Check, Circle, Clock3, LoaderCircle, X } from "lucide-react";
import type { DAGNode } from "../../types/api";

interface PipelineStepIndicatorProps {
  nodes: DAGNode[];
  startedAt?: string;
  endedAt?: string;
  running: boolean;
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const getStepDuration = (node: DAGNode): number | undefined => {
  if (typeof node.durationMs === "number") return node.durationMs;
  if (node.startedAt && node.completedAt) {
    return Math.max(
      0,
      Date.parse(node.completedAt) - Date.parse(node.startedAt),
    );
  }
  return undefined;
};

const PipelineStepIndicator: FC<PipelineStepIndicatorProps> = ({
  nodes,
  startedAt,
  endedAt,
  running,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const completedCount = nodes.filter(
    (node) => node.status === "completed",
  ).length;
  const activeNode = nodes.find((node) => node.status === "running");
  const selectedNode = nodes.find(
    (node) => node.nodeId === selectedNodeId && node.status === "completed",
  );
  const elapsedMs = startedAt
    ? Math.max(0, (endedAt ? Date.parse(endedAt) : now) - Date.parse(startedAt))
    : 0;
  const progress = nodes.length ? (completedCount / nodes.length) * 100 : 0;
  const activeLabel = activeNode?.agentType || activeNode?.nodeId || "Waiting";

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!nodes.length) return null;

  return (
    <section
      className="glass-panel"
      aria-label="Agent pipeline progress"
      data-testid="pipeline-step-indicator"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          Pipeline progress
        </h2>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>{nodes.length - completedCount} steps remaining</span>
          <span
            className="inline-flex items-center gap-1"
            aria-label={`Total elapsed ${formatDuration(elapsedMs)}`}
          >
            <Clock3 size={13} /> {formatDuration(elapsedMs)} elapsed
          </span>
        </div>
      </div>

      <ol className="hidden items-start sm:flex" aria-label="Pipeline steps">
        {nodes.map((node, index) => {
          const status = node.status;
          const isComplete = status === "completed";
          const label = node.agentType || node.nodeId.replace(/^node[_-]/, "");
          const duration = getStepDuration(node);
          const Icon = isComplete
            ? Check
            : status === "running"
              ? LoaderCircle
              : status === "failed"
                ? X
                : Circle;
          const statusClass = isComplete
            ? "border-[var(--success)] bg-[var(--status-success-surface)] text-[var(--success)]"
            : status === "running"
              ? "pipeline-step-active border-[var(--primary)] bg-[var(--accent-surface-strong)] text-[var(--primary)]"
              : status === "failed"
                ? "border-[var(--danger)] bg-[var(--status-danger-surface)] text-[var(--danger)]"
                : "border-[var(--border-strong)] bg-[var(--surface-elevated)] text-[var(--text-muted)]";

          return (
            <li key={node.nodeId} className="flex min-w-0 flex-1 items-start">
              <button
                type="button"
                className="flex min-w-0 flex-col items-center text-center disabled:cursor-default"
                onClick={() => isComplete && setSelectedNodeId(node.nodeId)}
                disabled={!isComplete}
                aria-label={`${label}, ${status}${duration === undefined ? "" : `, ${formatDuration(duration)}`}`}
                aria-pressed={selectedNodeId === node.nodeId}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 ${statusClass}`}
                >
                  <Icon
                    size={16}
                    className={status === "running" ? "animate-spin" : ""}
                  />
                </span>
                <span className="mt-2 max-w-full truncate text-xs font-medium text-[var(--text-primary)]">
                  {label}
                </span>
                {isComplete && duration !== undefined && (
                  <span className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {formatDuration(duration)}
                  </span>
                )}
              </button>
              {index < nodes.length - 1 && (
                <span
                  className={`mt-4 h-px min-w-3 flex-1 ${isComplete ? "bg-[var(--success)]" : "bg-[var(--border-strong)]"}`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>

      <div className="sm:hidden" aria-label="Compact pipeline progress">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs">
          <span className="max-w-[10ch] truncate font-medium text-[var(--text-primary)]">
            {activeLabel}
          </span>
          <span className="shrink-0 text-[var(--text-secondary)]">
            {completedCount}/{nodes.length}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-elevated)]"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={nodes.length}
          aria-valuenow={completedCount}
        >
          <div
            className="h-full rounded-full bg-[var(--success)] transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {selectedNode && (
        <aside
          className="mt-5 border-t border-[var(--panel-border)] pt-4"
          aria-label={`${selectedNode.agentType} output`}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {selectedNode.agentType} output
            </h3>
            <button
              type="button"
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              onClick={() => setSelectedNodeId(null)}
            >
              Close
            </button>
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-glass-subtle)] p-3 text-xs text-[var(--text-secondary)]">
            {typeof selectedNode.result === "string"
              ? selectedNode.result
              : JSON.stringify(selectedNode.result ?? {}, null, 2)}
          </pre>
        </aside>
      )}
    </section>
  );
};

export default PipelineStepIndicator;
