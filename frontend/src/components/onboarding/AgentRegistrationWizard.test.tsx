import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentRegistrationWizard } from './AgentRegistrationWizard';

const baseProps = {
  currentStep: 1 as const,
  formData: {
    capabilities: [],
    pricePerTask: 0.1,
    minimumDeposit: 0,
    stellarPublicKey: '',
  },
  setCapabilities: vi.fn(),
  setPricePerTask: vi.fn(),
  setMinimumDeposit: vi.fn(),
  setStellarPublicKey: vi.fn(),
  goBack: vi.fn(),
  goNext: vi.fn(),
  submit: vi.fn(),
  isSubmitting: false,
  error: null,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ estimatedGas: '0.0001' }),
  }));
});

describe('AgentRegistrationWizard', () => {
  it('renders step 1 with capability checkboxes', () => {
    const { container } = render(<AgentRegistrationWizard {...baseProps} />);
    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    // All 5 capabilities should be present
    expect(screen.getByLabelText('research')).toBeInTheDocument();
    expect(screen.getByLabelText('risk')).toBeInTheDocument();
    expect(screen.getByLabelText('coding')).toBeInTheDocument();
    expect(screen.getByLabelText('design')).toBeInTheDocument();
    expect(screen.getByLabelText('report')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('renders step 2 with pricing inputs', () => {
    const { container } = render(<AgentRegistrationWizard {...baseProps} currentStep={2} />);
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/price per task/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimum deposit/i)).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('renders step 3 with stellar key input', () => {
    const { container } = render(<AgentRegistrationWizard {...baseProps} currentStep={3} />);
    expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/public key/i)).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('renders step 4 confirmation', () => {
    const { container } = render(
      <AgentRegistrationWizard
        {...baseProps}
        currentStep={4}
        formData={{ capabilities: ['research'], pricePerTask: 1.5, minimumDeposit: 10, stellarPublicKey: 'GTEST...' }}
      />
    );
    expect(screen.getByText(/step 4 of 4/i)).toBeInTheDocument();
    expect(screen.getByText('research')).toBeInTheDocument();
    expect(container).toMatchSnapshot();
  });

  it('progress indicator shows correct step', () => {
    render(<AgentRegistrationWizard {...baseProps} currentStep={3} />);
    expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();
  });
});
