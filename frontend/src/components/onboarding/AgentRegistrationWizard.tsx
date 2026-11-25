import React, { useState, useEffect, useCallback } from 'react';
import type { AgentPreference } from '../../types/api';

const CAPABILITIES: AgentPreference[] = ['research', 'risk', 'coding', 'design', 'report'];

interface WizardProps {
  currentStep: 1 | 2 | 3 | 4;
  formData: {
    capabilities: AgentPreference[];
    pricePerTask: number;
    minimumDeposit: number;
    stellarPublicKey: string;
  };
  setCapabilities: (caps: AgentPreference[]) => void;
  setPricePerTask: (price: number) => void;
  setMinimumDeposit: (deposit: number) => void;
  setStellarPublicKey: (key: string) => void;
  goBack: () => void;
  goNext: () => void;
  submit: () => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

// ── Step 1: Capabilities ──────────────────────────────────────────────────────

interface Step1Props {
  capabilities: AgentPreference[];
  setCapabilities: (caps: AgentPreference[]) => void;
  goNext: () => void;
}

function Step1Capabilities({ capabilities, setCapabilities, goNext }: Step1Props) {
  const [touched, setTouched] = useState(false);
  const hasSelection = capabilities.length > 0;

  const toggle = useCallback(
    (cap: AgentPreference) => {
      if (capabilities.includes(cap)) {
        setCapabilities(capabilities.filter(c => c !== cap));
      } else {
        setCapabilities([...capabilities, cap]);
      }
    },
    [capabilities, setCapabilities],
  );

  const handleNext = () => {
    setTouched(true);
    if (hasSelection) goNext();
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Select Capabilities
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Choose the task types your agent can handle. At least one is required.
      </p>

      <div className="flex flex-col gap-3 mb-6">
        {CAPABILITIES.map(cap => {
          const checked = capabilities.includes(cap);
          return (
            <label
              key={cap}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                background: checked ? 'var(--surface-elevated)' : 'transparent',
                border: `1px solid ${checked ? 'var(--accent-secondary)' : 'var(--border-strong)'}`,
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(cap)}
                className="w-4 h-4 accent-[var(--accent-secondary)]"
                aria-label={cap}
              />
              <span
                className="capitalize font-medium text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                {cap}
              </span>
            </label>
          );
        })}
      </div>

      {touched && !hasSelection && (
        <p className="text-sm mb-4 text-red-400">Please select at least one capability.</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleNext}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity"
          style={{ background: 'var(--accent-secondary)', color: '#fff' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Pricing ───────────────────────────────────────────────────────────

interface Step2Props {
  pricePerTask: number;
  minimumDeposit: number;
  setPricePerTask: (p: number) => void;
  setMinimumDeposit: (d: number) => void;
  goBack: () => void;
  goNext: () => void;
}

function Step2Pricing({
  pricePerTask,
  minimumDeposit,
  setPricePerTask,
  setMinimumDeposit,
  goBack,
  goNext,
}: Step2Props) {
  const [touched, setTouched] = useState(false);

  const priceError = pricePerTask < 0.1 ? 'Minimum price is 0.1 XLM.' : null;
  const depositError = minimumDeposit < 0 ? 'Deposit cannot be negative.' : null;
  const isValid = !priceError && !depositError;

  const handleNext = () => {
    setTouched(true);
    if (isValid) goNext();
  };

  const inputClass =
    'w-full rounded-lg px-3 py-2 text-sm outline-none transition-colors';
  const inputStyle = {
    background: 'var(--surface-elevated)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-primary)',
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Set Pricing
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Define how much you charge per task and the minimum deposit you require.
      </p>

      <div className="flex flex-col gap-5 mb-6">
        <div>
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--text-primary)' }}
            htmlFor="price-per-task"
          >
            Price per Task (XLM)
          </label>
          <input
            id="price-per-task"
            type="number"
            min={0.1}
            step={0.01}
            value={pricePerTask}
            onChange={e => setPricePerTask(parseFloat(e.target.value) || 0)}
            className={inputClass}
            style={inputStyle}
          />
          {touched && priceError && (
            <p className="text-xs mt-1 text-red-400">{priceError}</p>
          )}
        </div>

        <div>
          <label
            className="block text-sm font-medium mb-1"
            style={{ color: 'var(--text-primary)' }}
            htmlFor="minimum-deposit"
          >
            Minimum Deposit (XLM)
          </label>
          <input
            id="minimum-deposit"
            type="number"
            min={0}
            step={0.01}
            value={minimumDeposit}
            onChange={e => setMinimumDeposit(parseFloat(e.target.value) || 0)}
            className={inputClass}
            style={inputStyle}
          />
          {touched && depositError && (
            <p className="text-xs mt-1 text-red-400">{depositError}</p>
          )}
        </div>
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={goBack}
          className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="px-5 py-2 rounded-lg text-sm font-semibold"
          style={{ background: 'var(--accent-secondary)', color: '#fff' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Stellar Key ───────────────────────────────────────────────────────

type KeyValidationState = 'idle' | 'loading' | 'valid' | 'invalid';

interface Step3Props {
  stellarPublicKey: string;
  setStellarPublicKey: (key: string) => void;
  goBack: () => void;
  goNext: () => void;
}

function Step3StellarKey({
  stellarPublicKey,
  setStellarPublicKey,
  goBack,
  goNext,
}: Step3Props) {
  const [validation, setValidation] = useState<KeyValidationState>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [attemptedNext, setAttemptedNext] = useState(false);

  const validateKey = useCallback(async (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) {
      setValidation('idle');
      setValidationError(null);
      return;
    }
    setValidation('loading');
    setValidationError(null);
    try {
      const res = await fetch(
        `https://horizon-testnet.stellar.org/accounts/${encodeURIComponent(trimmed)}`,
      );
      if (res.ok) {
        setValidation('valid');
      } else if (res.status === 404) {
        setValidation('invalid');
        setValidationError('Account not found on Stellar testnet.');
      } else {
        setValidation('invalid');
        setValidationError(`Validation failed (HTTP ${res.status}).`);
      }
    } catch {
      setValidation('invalid');
      setValidationError('Could not reach Horizon API. Check your connection.');
    }
  }, []);

  const handleBlur = () => {
    validateKey(stellarPublicKey);
  };

  const handleNext = () => {
    setAttemptedNext(true);
    if (!stellarPublicKey.trim()) {
      setValidationError('A Stellar public key is required.');
      return;
    }
    if (validation === 'valid') {
      goNext();
    } else if (validation === 'idle') {
      // trigger validation first, then the user can click again
      validateKey(stellarPublicKey);
    }
  };

  const inputClass = 'w-full rounded-lg px-3 py-2 text-sm outline-none font-mono transition-colors';
  const borderColor =
    validation === 'valid'
      ? 'var(--accent-secondary)'
      : validation === 'invalid'
        ? '#f87171'
        : 'var(--border-strong)';

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Stellar Public Key
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Enter the Stellar public key associated with your agent. It will be validated
        against the Horizon testnet.
      </p>

      <div className="mb-6">
        <label
          className="block text-sm font-medium mb-1"
          style={{ color: 'var(--text-primary)' }}
          htmlFor="stellar-key"
        >
          Public Key
        </label>
        <div className="relative">
          <input
            id="stellar-key"
            type="text"
            value={stellarPublicKey}
            onChange={e => {
              setStellarPublicKey(e.target.value);
              setValidation('idle');
              setValidationError(null);
            }}
            onBlur={handleBlur}
            placeholder="GABC…"
            className={inputClass}
            style={{
              background: 'var(--surface-elevated)',
              border: `1px solid ${borderColor}`,
              color: 'var(--text-primary)',
              paddingRight: '2.5rem',
            }}
            aria-describedby="key-status"
          />
          {validation === 'loading' && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: 'var(--text-secondary)' }}
              aria-live="polite"
              id="key-status"
            >
              Checking…
            </span>
          )}
          {validation === 'valid' && (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-400"
              aria-live="polite"
              id="key-status"
            >
              ✓
            </span>
          )}
        </div>

        {(validationError || (attemptedNext && !stellarPublicKey.trim())) && (
          <p className="text-xs mt-1 text-red-400" role="alert">
            {validationError || 'A Stellar public key is required.'}
          </p>
        )}
      </div>

      <div className="flex justify-between">
        <button
          type="button"
          onClick={goBack}
          className="px-5 py-2 rounded-lg text-sm font-semibold"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          disabled={validation === 'loading' || validation === 'invalid'}
          className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent-secondary)', color: '#fff' }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Confirmation ──────────────────────────────────────────────────────

interface Step4Props {
  formData: WizardProps['formData'];
  goBack: () => void;
  submit: () => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

function Step4Confirmation({ formData, goBack, submit, isSubmitting, error }: Step4Props) {
  const [gasEstimate, setGasEstimate] = useState<string | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setGasLoading(true);
    setGasError(null);

    const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
    fetch(`${BASE_URL}/api/agents/register/estimate`)
      .then(async res => {
        if (cancelled) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setGasEstimate(data.estimatedGas ?? data.gas ?? String(data));
      })
      .catch(err => {
        if (!cancelled) setGasError(err instanceof Error ? err.message : 'Could not load estimate');
      })
      .finally(() => {
        if (!cancelled) setGasLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const rowStyle = {
    borderBottom: '1px solid var(--border-strong)',
  };
  const labelStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
    fontSize: '0.75rem',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    paddingBottom: '0.25rem',
  };
  const valueStyle = {
    color: 'var(--text-primary)',
    fontSize: '0.875rem',
  };

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        Confirm Registration
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Review your details before submitting.
      </p>

      <div
        className="rounded-lg p-4 mb-4 flex flex-col gap-3"
        style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-strong)' }}
      >
        <div style={rowStyle} className="pb-3">
          <p style={labelStyle}>Capabilities</p>
          <p style={valueStyle}>{formData.capabilities.join(', ') || '—'}</p>
        </div>
        <div style={rowStyle} className="pb-3">
          <p style={labelStyle}>Price per Task</p>
          <p style={valueStyle}>{formData.pricePerTask} XLM</p>
        </div>
        <div style={rowStyle} className="pb-3">
          <p style={labelStyle}>Minimum Deposit</p>
          <p style={valueStyle}>{formData.minimumDeposit} XLM</p>
        </div>
        <div>
          <p style={labelStyle}>Stellar Public Key</p>
          <p
            style={{ ...valueStyle, wordBreak: 'break-all', fontFamily: 'monospace' }}
          >
            {formData.stellarPublicKey || '—'}
          </p>
        </div>
      </div>

      <div
        className="rounded-lg p-3 mb-6 text-sm"
        style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-strong)' }}
      >
        <span style={labelStyle}>Estimated Gas Cost: </span>
        {gasLoading && (
          <span style={{ color: 'var(--text-secondary)' }}>Fetching estimate…</span>
        )}
        {!gasLoading && gasError && (
          <span className="text-red-400">{gasError}</span>
        )}
        {!gasLoading && gasEstimate && (
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{gasEstimate} XLM</span>
        )}
      </div>

      {error && (
        <p className="text-sm mb-4 text-red-400 rounded-lg p-3" style={{ background: '#fee2e220' }} role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={isSubmitting}
          className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isSubmitting}
          className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent-secondary)', color: '#fff' }}
        >
          {isSubmitting ? 'Registering…' : 'Confirm & Register'}
        </button>
      </div>
    </div>
  );
}

// ── Progress Indicator ────────────────────────────────────────────────────────

function StepProgress({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Step {current} of {total}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {Math.round((current / total) * 100)}%
        </span>
      </div>
      <div
        className="w-full h-1.5 rounded-full overflow-hidden"
        style={{ background: 'var(--border-strong)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${(current / total) * 100}%`,
            background: 'var(--accent-secondary)',
          }}
        />
      </div>
    </div>
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function AgentRegistrationWizard({
  currentStep,
  formData,
  setCapabilities,
  setPricePerTask,
  setMinimumDeposit,
  setStellarPublicKey,
  goBack,
  goNext,
  submit,
  isSubmitting,
  error,
}: WizardProps) {
  return (
    <div
      className="glass-panel rounded-xl p-6"
      style={{ border: '1px solid var(--border-strong)' }}
    >
      <StepProgress current={currentStep} total={4} />

      {currentStep === 1 && (
        <Step1Capabilities
          capabilities={formData.capabilities}
          setCapabilities={setCapabilities}
          goNext={goNext}
        />
      )}

      {currentStep === 2 && (
        <Step2Pricing
          pricePerTask={formData.pricePerTask}
          minimumDeposit={formData.minimumDeposit}
          setPricePerTask={setPricePerTask}
          setMinimumDeposit={setMinimumDeposit}
          goBack={goBack}
          goNext={goNext}
        />
      )}

      {currentStep === 3 && (
        <Step3StellarKey
          stellarPublicKey={formData.stellarPublicKey}
          setStellarPublicKey={setStellarPublicKey}
          goBack={goBack}
          goNext={goNext}
        />
      )}

      {currentStep === 4 && (
        <Step4Confirmation
          formData={formData}
          goBack={goBack}
          submit={submit}
          isSubmitting={isSubmitting}
          error={error}
        />
      )}
    </div>
  );
}
