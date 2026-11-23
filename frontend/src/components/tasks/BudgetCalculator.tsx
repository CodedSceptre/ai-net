import React, { useState, useCallback } from 'react';
import { AlertTriangle, Lock, Calculator } from 'lucide-react';
import { useBudgetEstimate } from '../../hooks/useBudgetEstimate';
import type { AgentPreference } from '../../types/api';
import styles from './BudgetCalculator.module.css';

export interface BudgetCalculatorValues {
  prompt: string;
  maxBudgetXLM: number;
}

export interface BudgetCalculatorProps {
  /** Called when user clicks "Lock in Budget"; receives prompt + maxBudgetXLM. */
  onLockBudget?: (values: BudgetCalculatorValues) => void;
  /** Initial prompt value. */
  initialPrompt?: string;
}

const BUFFER_RATE = 0.1;
const SLIDER_MAX = 100;

function getComplexityLabel(nodeCount: number): {
  label: string;
  cls: string;
} {
  if (nodeCount <= 2) return { label: 'Simple (1–2 agents)', cls: styles.complexitySimple };
  if (nodeCount <= 4) return { label: 'Moderate (3–4 agents)', cls: styles.complexityModerate };
  return { label: 'Complex (5+ agents)', cls: styles.complexityComplex };
}

function formatXLM(n: number): string {
  return n.toFixed(4);
}

function formatUSD(xlm: number, rate: number): string {
  return (xlm * rate).toFixed(2);
}

export const BudgetCalculator: React.FC<BudgetCalculatorProps> = ({
  onLockBudget,
  initialPrompt = '',
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [budgetXLM, setBudgetXLM] = useState(10);

  const { estimate, loading, error, xlmUsdRate } = useBudgetEstimate(prompt);

  const totalWithBuffer = estimate
    ? estimate.estimatedCostXLM * (1 + BUFFER_RATE)
    : 0;
  const bufferAmount = estimate
    ? estimate.estimatedCostXLM * BUFFER_RATE
    : 0;
  const nodeCount = estimate?.breakdown.length ?? 0;
  const complexity = getComplexityLabel(nodeCount);
  const isBelowEstimate = estimate !== null && budgetXLM < totalWithBuffer;

  const handlePromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setPrompt(e.target.value);
    },
    []
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setBudgetXLM(Number(e.target.value));
    },
    []
  );

  const handleLock = useCallback(() => {
    onLockBudget?.({ prompt, maxBudgetXLM: budgetXLM });
  }, [onLockBudget, prompt, budgetXLM]);

  return (
    <div className={styles.container} data-testid="budget-calculator">
      <h3 className={styles.title}>
        <Calculator size={16} aria-hidden="true" />
        Budget Calculator
      </h3>

      {/* Prompt input */}
      <div>
        <label htmlFor="budget-prompt" className={styles.promptLabel}>
          Describe your task
        </label>
        <textarea
          id="budget-prompt"
          className={styles.textarea}
          value={prompt}
          onChange={handlePromptChange}
          placeholder="E.g. Research and analyze the EV market in Southeast Asia…"
          rows={3}
          aria-label="Task prompt for cost estimation"
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className={styles.loadingRow} aria-live="polite" aria-label="Calculating estimate">
          <span className={styles.spinner} aria-hidden="true" />
          Calculating estimate…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <p className={styles.errorMsg} role="alert">
          {error}
        </p>
      )}

      {/* Complexity indicator */}
      {!loading && estimate && (
        <div>
          <span className={`${styles.complexity} ${complexity.cls}`}>
            {complexity.label}
          </span>
        </div>
      )}

      {/* Cost breakdown */}
      {!loading && estimate && (
        <table className={styles.breakdownTable} aria-label="Cost breakdown">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Est. XLM</th>
              <th>Est. Time</th>
            </tr>
          </thead>
          <tbody>
            {estimate.breakdown.map((item) => (
              <tr key={item.agent}>
                <td>
                  <span className={styles.agentBadge}>{item.agent}</span>
                </td>
                <td>{formatXLM(item.costXLM)} XLM</td>
                <td>—</td>
              </tr>
            ))}

            {/* Platform fee */}
            {estimate.platformFeeXLM > 0 && (
              <tr>
                <td>Platform fee</td>
                <td>{formatXLM(estimate.platformFeeXLM)} XLM</td>
                <td>—</td>
              </tr>
            )}

            {/* 10 % buffer */}
            <tr className={styles.bufferRow}>
              <td>10% buffer</td>
              <td>{formatXLM(bufferAmount)} XLM</td>
              <td />
            </tr>

            {/* Total */}
            <tr className={styles.totalRow}>
              <td>Total (with buffer)</td>
              <td>{formatXLM(totalWithBuffer)} XLM</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}

      {/* USD equivalent */}
      {!loading && estimate && xlmUsdRate !== null && (
        <p className={styles.usdEquivalent}>
          ≈ ${formatUSD(totalWithBuffer, xlmUsdRate)} USD
        </p>
      )}

      {/* Budget slider */}
      <div className={styles.sliderSection}>
        <div className={styles.sliderHeader}>
          <span className={styles.sliderLabel}>Max budget</span>
          <span className={styles.sliderValue}>{budgetXLM} XLM</span>
        </div>
        <input
          type="range"
          className={styles.slider}
          min={0}
          max={SLIDER_MAX}
          step={0.5}
          value={budgetXLM}
          onChange={handleSliderChange}
          aria-label={`Max budget: ${budgetXLM} XLM`}
          aria-valuemin={0}
          aria-valuemax={SLIDER_MAX}
          aria-valuenow={budgetXLM}
        />

        {isBelowEstimate && (
          <div className={styles.budgetWarning} role="alert">
            <AlertTriangle size={14} aria-hidden="true" />
            Budget is below the estimated cost of {formatXLM(totalWithBuffer)} XLM
          </div>
        )}
      </div>

      {/* Lock in budget */}
      <button
        className={styles.lockButton}
        onClick={handleLock}
        disabled={!estimate || loading}
        aria-disabled={!estimate || loading}
        type="button"
      >
        <Lock size={14} aria-hidden="true" />
        Lock in Budget
      </button>
    </div>
  );
};

export default BudgetCalculator;
