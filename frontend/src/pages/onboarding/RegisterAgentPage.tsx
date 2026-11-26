import React from 'react';
import { AgentRegistrationWizard } from '../../components/onboarding/AgentRegistrationWizard';
import { useAgentRegistration } from '../../hooks/useAgentRegistration';

const RegisterAgentPage: React.FC = () => {
  const registration = useAgentRegistration();

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Register Your Agent</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Join the AI-Net network by registering your agent in four steps.
        </p>
      </div>
      <AgentRegistrationWizard {...registration} />
    </div>
  );
};

export default RegisterAgentPage;
