import { useState } from 'react';
import { Check } from 'lucide-react';
import styles from './TaskCreationStepper.module.css';

// ── Types ──────────────────────────────────────────────────────────────────────

interface StepperFormState {
  prompt: string;
  budgetXLM: number;
}

export interface TaskCreationStepperProps {
  onSubmit: (data: { prompt: string; budgetXLM: number }) => void;
  initialPrompt?: string;
  initialBudget?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PROMPT_MAX_CHARS = 2000;
const BUDGET_MIN = 1;
const BUDGET_MAX = 1000;
const BUDGET_DEFAULT = 50;
const XLM_TO_USD = 0.11;

const PROMPT_SUGGESTIONS = [
  'Analyze market trends for...',
  'Write a risk assessment for...',
  'Research and summarize the latest developments in...',
  'Create a comprehensive report on...',
  'Evaluate the feasibility of...',
];

/** Per-agent cost estimates in XLM. */
const AGENT_COSTS: Record<string, number> = {
  research: 0.5,
  risk: 0.4,
  coding: 0.8,
  design: 0.6,
  report: 0.3,
};

const STEP_LABELS = ['Describe', 'Budget', 'Review'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns agents that fit within 90% of budgetXLM (10% platform fee). */
function estimateAgents(budgetXLM: number): Array<{ name: string; cost: number }> {
  const agents = Object.entries(AGENT_COSTS);
  const result: Array<{ name: string; cost: number }> = [];
  let remaining = budgetXLM * 0.9;
  for (const [name, cost] of agents) {
    if (remaining >= cost) {
      result.push({ name, cost });
      remaining -= cost;
    }
  }
  return result;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

interface StepIndicatorProps {
  currentStep: number;
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className={styles.stepIndicator} aria-label="Form progress">
      {STEP_LABELS.map((label, index) => {
        const stepNum = index + 1;
        const isCompleted = stepNum < currentStep;
        const isActive = stepNum === currentStep;
        return (
          <div key={label} className={styles.stepItem}>
            <div
              className={[
                styles.stepCircle,
                isActive ? styles.active : '',
                isCompleted ? styles.completed : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-current={isActive ? 'step' : undefined}
              aria-label={`Step ${stepNum}: ${label}${isCompleted ? ' (completed)' : isActive ? ' (current)' : ''}`}
            >
              {isCompleted ? <Check size={16} aria-hidden="true" /> : stepNum}
            </div>
            <span className={styles.stepLabel}>{label}</span>
            {index < STEP_LABELS.length - 1 && (
              <div
                className={[styles.stepConnector, isCompleted ? styles.stepConnectorDone : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── DAG Preview ────────────────────────────────────────────────────────────────

interface DagPreviewProps {
  budgetXLM: number;
}

function DagPreview({ budgetXLM }: DagPreviewProps) {
  const agents = estimateAgents(budgetXLM);
  const subtotal = agents.reduce((sum, a) => sum + a.cost, 0);
  const platformFee = subtotal * 0.1;
  const total = subtotal + platformFee;
  const isBudgetInsufficient = budgetXLM < total;

  return (
    <div className={styles.dagPreview}>
      <p className={styles.dagTitle}>Estimated Agents</p>
      {agents.length === 0 ? (
        <p className={styles.noAgents}>No agents fit within this budget.</p>
      ) : (
        <>
          {agents.map(({ name, cost }) => (
            <div key={name} className={styles.agentRow}>
              <span className={styles.agentName}>{name}</span>
              <span className={styles.agentCost}>{cost.toFixed(2)} XLM</span>
            </div>
          ))}
          <div className={styles.dagDivider} aria-hidden="true" />
          <div className={styles.agentRow}>
            <span className={styles.dagLabel}>Subtotal</span>
            <span className={styles.dagValue}>{subtotal.toFixed(2)} XLM</span>
          </div>
          <div className={styles.agentRow}>
            <span className={styles.dagLabel}>Platform fee (10%)</span>
            <span className={styles.dagValue}>{platformFee.toFixed(2)} XLM</span>
          </div>
          <div className={[styles.agentRow, styles.dagTotal].join(' ')}>
            <span className={styles.dagTotalLabel}>Total</span>
            <span className={styles.dagTotalValue}>{total.toFixed(2)} XLM</span>
          </div>
        </>
      )}
      {isBudgetInsufficient && agents.length > 0 && (
        <div className={styles.budgetWarning} role="alert">
          Budget may be insufficient for all agents
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function TaskCreationStepper({
  onSubmit,
  initialPrompt = '',
  initialBudget = BUDGET_DEFAULT,
}: TaskCreationStepperProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [form, setForm] = useState<StepperFormState>({
    prompt: initialPrompt,
    budgetXLM: initialBudget,
  });

  const charCountWarning = form.prompt.length > PROMPT_MAX_CHARS * 0.8;
  const isPromptValid = form.prompt.trim().length >= 10;
  const isBudgetValid = form.budgetXLM >= BUDGET_MIN;
  const canSubmit = isPromptValid && isBudgetValid;

  function goNext() {
    setDirection('forward');
    setCurrentStep((s) => Math.min(s + 1, 3));
  }

  function goBack() {
    setDirection('backward');
    setCurrentStep((s) => Math.max(s - 1, 1));
  }

  function goToStep(step: number) {
    setDirection(step < currentStep ? 'backward' : 'forward');
    setCurrentStep(step);
  }

  function handlePromptChange(value: string) {
    setForm((prev) => ({ ...prev, prompt: value }));
  }

  function handleSuggestionClick(suggestion: string) {
    setForm((prev) => ({ ...prev, prompt: suggestion + ' ' }));
  }

  function handleBudgetChange(value: number) {
    setForm((prev) => ({ ...prev, budgetXLM: value }));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ prompt: form.prompt, budgetXLM: form.budgetXLM });
  }

  return (
    <div className={styles.stepper}>
      <StepIndicator currentStep={currentStep} />

      <div className={styles.stepContent} data-direction={direction}>
        {/* ── Step 1: Describe ─────────────────────────────────────────────── */}
        {currentStep === 1 && (
          <div className={styles.stepPane}>
            <h2 className={styles.stepTitle}>Describe your task</h2>
            <div className={styles.field}>
              <label htmlFor="stepper-prompt" className={styles.fieldLabel}>
                Task description
              </label>
              <textarea
                id="stepper-prompt"
                className={styles.textarea}
                placeholder="Describe your task in detail..."
                maxLength={PROMPT_MAX_CHARS}
                value={form.prompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                aria-describedby="stepper-char-count"
              />
              <div className={styles.charCountRow}>
                <span
                  id="stepper-char-count"
                  className={[
                    styles.charCount,
                    charCountWarning ? styles.charCountWarning : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {form.prompt.length}/{PROMPT_MAX_CHARS}
                </span>
              </div>
            </div>

            <div className={styles.suggestionChips} role="group" aria-label="Prompt suggestions">
              {PROMPT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className={styles.chip}
                  onClick={() => handleSuggestionClick(suggestion)}
                  aria-label={`Use suggestion: ${suggestion}`}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className={styles.buttonGroup}>
              <span />
              <button
                type="button"
                className={styles.nextButton}
                onClick={goNext}
                disabled={!isPromptValid}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Budget ───────────────────────────────────────────────── */}
        {currentStep === 2 && (
          <div className={styles.stepPane}>
            <h2 className={styles.stepTitle}>Set your budget</h2>

            <div className={styles.field}>
              <label htmlFor="stepper-budget" className={styles.fieldLabel}>
                Budget
              </label>
              <div className={styles.budgetDisplay}>
                <span className={styles.budgetAmount}>{form.budgetXLM} XLM</span>
                <span className={styles.budgetUsd}>
                  ≈ ${(form.budgetXLM * XLM_TO_USD).toFixed(2)}
                </span>
              </div>
              <input
                id="stepper-budget"
                type="range"
                className={styles.slider}
                min={BUDGET_MIN}
                max={BUDGET_MAX}
                step={1}
                value={form.budgetXLM}
                onChange={(e) => handleBudgetChange(Number(e.target.value))}
                aria-label={`Budget: ${form.budgetXLM} XLM`}
                aria-valuemin={BUDGET_MIN}
                aria-valuemax={BUDGET_MAX}
                aria-valuenow={form.budgetXLM}
              />
              <div className={styles.sliderLabels} aria-hidden="true">
                <span>{BUDGET_MIN} XLM</span>
                <span>{BUDGET_MAX} XLM</span>
              </div>
            </div>

            <DagPreview budgetXLM={form.budgetXLM} />

            <div className={styles.buttonGroup}>
              <button type="button" className={styles.backButton} onClick={goBack}>
                ← Back
              </button>
              <button type="button" className={styles.nextButton} onClick={goNext}>
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Review ───────────────────────────────────────────────── */}
        {currentStep === 3 && (
          <div className={styles.stepPane}>
            <h2 className={styles.stepTitle}>Review your task</h2>

            <section className={styles.reviewSection}>
              <div className={styles.reviewSectionHeader}>
                <h3 className={styles.reviewSectionTitle}>Task Description</h3>
                <button
                  type="button"
                  className={styles.editLink}
                  onClick={() => goToStep(1)}
                  aria-label="Edit task description"
                >
                  Edit
                </button>
              </div>
              <p className={styles.reviewText}>{form.prompt}</p>
            </section>

            <section className={styles.reviewSection}>
              <div className={styles.reviewSectionHeader}>
                <h3 className={styles.reviewSectionTitle}>Budget</h3>
                <button
                  type="button"
                  className={styles.editLink}
                  onClick={() => goToStep(2)}
                  aria-label="Edit budget"
                >
                  Edit
                </button>
              </div>
              <p className={styles.reviewBudget}>
                <span className={styles.reviewBudgetAmount}>{form.budgetXLM} XLM</span>
                <span className={styles.reviewBudgetUsd}>
                  ≈ ${(form.budgetXLM * XLM_TO_USD).toFixed(2)}
                </span>
              </p>
            </section>

            <section className={styles.reviewSection}>
              <h3 className={styles.reviewSectionTitle}>Estimated Agents</h3>
              <DagPreview budgetXLM={form.budgetXLM} />
            </section>

            <div className={styles.buttonGroup}>
              <button type="button" className={styles.backButton} onClick={goBack}>
                ← Back
              </button>
              <button
                type="button"
                className={styles.submitButton}
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                Submit Task
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskCreationStepper;
