import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AgentPreference } from '../types/api';

export interface AgentRegistrationFormData {
  capabilities: AgentPreference[];
  pricePerTask: number;
  minimumDeposit: number;
  stellarPublicKey: string;
}

export type RegistrationStep = 1 | 2 | 3 | 4;

export interface UseAgentRegistrationReturn {
  currentStep: RegistrationStep;
  formData: AgentRegistrationFormData;
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

export function useAgentRegistration(): UseAgentRegistrationReturn {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<RegistrationStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<AgentRegistrationFormData>({
    capabilities: [],
    pricePerTask: 0.1,
    minimumDeposit: 0,
    stellarPublicKey: '',
  });

  const setCapabilities = useCallback((caps: AgentPreference[]) => {
    setFormData(prev => ({ ...prev, capabilities: caps }));
  }, []);

  const setPricePerTask = useCallback((price: number) => {
    setFormData(prev => ({ ...prev, pricePerTask: price }));
  }, []);

  const setMinimumDeposit = useCallback((deposit: number) => {
    setFormData(prev => ({ ...prev, minimumDeposit: deposit }));
  }, []);

  const setStellarPublicKey = useCallback((key: string) => {
    setFormData(prev => ({ ...prev, stellarPublicKey: key }));
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep(prev => (prev > 1 ? ((prev - 1) as RegistrationStep) : prev));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep(prev => (prev < 4 ? ((prev + 1) as RegistrationStep) : prev));
  }, []);

  const submit = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
      const pubKey = localStorage.getItem('wallet_pubkey') || localStorage.getItem('walletAddress');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pubKey) headers['Authorization'] = `Bearer ${pubKey}`;

      const res = await fetch(`${BASE_URL}/api/agents/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Registration failed (${res.status})`);
      }

      const data = await res.json();
      navigate(`/agents/${data.agentId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, navigate]);

  return {
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
  };
}
