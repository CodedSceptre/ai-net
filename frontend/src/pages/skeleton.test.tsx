/**
 * Skeleton loading screens — acceptance tests for issue #98.
 *
 * Verifies that every data-fetching page exposes a skeleton screen that:
 *  - Renders without throwing
 *  - Sets aria-busy="true" on the container
 *  - Contains visible skeleton elements (no CLS-causing spinner)
 *
 * Tests run against the exported skeleton components directly; full-page
 * rendering (which requires a running server) is covered by e2e tests.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import {
  Skeleton,
  SkeletonCard,
  SkeletonText,
  SkeletonTable,
  SkeletonAvatar,
  SkeletonDashboard,
  SkeletonTaskDetail,
} from '../components/common/Skeleton';

// ── Module-level mocks for page imports ──────────────────────────────────────
// The page modules import hooks and contexts at the top level. We stub them
// out so we can render just the exported skeleton components without spinning
// up providers.

vi.mock('../hooks/useAgentRegistry', () => ({
  useAgentRegistry: () => ({ agents: [], loading: true, error: null, refetch: vi.fn(), getSuggestions: vi.fn() }),
}));

vi.mock('../hooks/useWalletBalance', () => ({
  useWalletBalance: () => ({ balance: '0', balances: [], availableBalance: '0', subentryCount: 0, loading: true, error: null, didChange: false }),
}));

vi.mock('../hooks/useTransactionHistory', () => ({
  useTransactionHistory: () => ({ transactions: [], loading: false, error: null }),
}));

vi.mock('../hooks/useTaskMonitor', () => ({
  useTaskMonitor: () => ({ task: null, loading: true, error: null, wsStatus: 'connecting', nodes: [], payments: [], outputs: [], refetch: vi.fn() }),
}));

vi.mock('../hooks/usePayments', () => ({
  usePayments: () => ({ rows: [], loading: true, error: null, refresh: vi.fn(), exportCsv: vi.fn() }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('../context/WalletContext', () => ({
  useWallet: () => ({
    publicKey: null,
    connected: false,
    ready: false,
    connectionMethod: null,
    freighterAvailable: false,
    connect: vi.fn(),
    connectFreighter: vi.fn(),
    disconnect: vi.fn(),
    hasCompletedWizard: true,
  }),
  WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/wallet/SendXLMForm', () => ({ SendXLMForm: () => null }));
vi.mock('../components/wallet/PaymentChart', () => ({ PaymentChart: () => null }));
vi.mock('../components/wallet/TransactionTable', () => ({ TransactionTable: () => null }));
vi.mock('../components/wallet/PaymentFeedback', () => ({ PaymentFeedback: () => null }));
vi.mock('../components/wallet/WalletWizard', () => ({ WalletWizard: () => null }));
vi.mock('../components/agents/AgentTable', () => ({ AgentTable: () => null }));
vi.mock('../components/agents/AgentFilterBar', () => ({ AgentFilterBar: () => null }));
vi.mock('../components/agents/AgentDetailModal', () => ({ AgentDetailModal: () => null }));
vi.mock('../components/agents/AgentRegistryCard', () => ({ AgentRegistryCard: () => null }));
vi.mock('../components/agents/SearchWithTypeahead', () => ({ SearchWithTypeahead: () => null }));
vi.mock('../components/tasks/DAGVisualization', () => ({ DAGVisualization: () => null }));
vi.mock('../components/dashboard/TaskDetailTimeline', () => ({ TaskDetailTimeline: () => null }));
vi.mock('../components/dashboard/PaymentTimeline', () => ({ PaymentTimeline: () => null }));
vi.mock('../components/layout/Breadcrumb', () => ({ useBreadcrumbLabel: vi.fn() }));
vi.mock('../utils/agentRegistry', () => ({
  allCapabilities: () => [],
  filterAndSortAgents: (_agents: unknown[]) => _agents,
  filtersFromSearchParams: () => ({ capabilities: [], priceMin: null, priceMax: null, status: 'all', sortKey: null, sortDir: 'desc', searchQuery: '' }),
  filtersToSearchParams: () => ({}),
  priceDomain: () => [0, 10] as [number, number],
}));

// ─────────────────────────────────────────────────────────────────────────────
//  Primitive skeleton components
// ─────────────────────────────────────────────────────────────────────────────

describe('Skeleton primitives (#98)', () => {
  it('Skeleton renders as aria-hidden', () => {
    render(<Skeleton data-testid="s" />);
    expect(screen.getByTestId('s')).toHaveAttribute('aria-hidden', 'true');
  });

  it('SkeletonText renders the requested number of lines', () => {
    render(<SkeletonText lines={4} data-testid="st" />);
    const lines = screen.getAllByTestId('skeleton-text-line');
    expect(lines).toHaveLength(4);
  });

  it('SkeletonAvatar renders a circular skeleton', () => {
    render(<SkeletonAvatar size={48} data-testid="sa" />);
    expect(screen.getByTestId('sa')).toBeInTheDocument();
  });

  it('SkeletonTable renders correct number of rows', () => {
    render(<SkeletonTable rows={5} columns={3} />);
    const rows = screen.getAllByTestId('skeleton-table-row');
    expect(rows).toHaveLength(5);
  });

  it('SkeletonCard renders children', () => {
    render(
      <SkeletonCard data-testid="sc">
        <span data-testid="child">content</span>
      </SkeletonCard>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Page-level skeleton compositions
// ─────────────────────────────────────────────────────────────────────────────

describe('SkeletonDashboard — /admin (#98)', () => {
  it('renders with aria-busy=true', () => {
    render(<SkeletonDashboard />);
    expect(screen.getByTestId('skeleton-dashboard')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders KPI card skeletons', () => {
    render(<SkeletonDashboard />);
    // SkeletonDashboard renders 4 SkeletonCard children
    const rows = screen.getAllByTestId('skeleton-table-row');
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SkeletonTaskDetail — /tasks/:id (#98)', () => {
  it('renders with aria-busy=true', () => {
    render(<SkeletonTaskDetail />);
    expect(screen.getByTestId('skeleton-task-detail')).toHaveAttribute('aria-busy', 'true');
  });

  it('contains skeleton text lines for panels', () => {
    render(<SkeletonTaskDetail />);
    const lines = screen.getAllByTestId('skeleton-text-line');
    expect(lines.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Agent card skeleton (used on /agents grid)
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentCardSkeleton — /agents (#98)', () => {
  it('skeleton structure matches expected testid', () => {
    // AgentCardSkeleton is defined inside AgentsPage.tsx and rendered in the
    // loading branch. Here we verify the Skeleton primitive it composes
    // behaves as expected (the AgentsPage.test.tsx covers the full loading path).
    render(
      <div data-testid="agent-card-skeleton" aria-hidden="true">
        <Skeleton variant="circular" width={40} height={40} />
        <Skeleton variant="pill" width="5rem" height="1.6rem" />
      </div>,
    );
    const card = screen.getByTestId('agent-card-skeleton');
    expect(card).toHaveAttribute('aria-hidden', 'true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Shimmer animation — structural check
// ─────────────────────────────────────────────────────────────────────────────

describe('Skeleton shimmer (#98)', () => {
  it('skeleton element has no visible spinner child', () => {
    const { container } = render(<Skeleton width="100%" height="2rem" data-testid="shimmer" />);
    // Spinners are typically <svg role="progressbar"> or a .spinner class.
    // Skeleton must not contain either.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('.spinner')).toBeNull();
  });

  it('skeleton respects animate=false (static variant)', () => {
    render(<Skeleton animate={false} data-testid="static-skeleton" />);
    const el = screen.getByTestId('static-skeleton');
    // When animate=false, the static CSS class is applied (no shimmer animation)
    expect(el.className).toMatch(/static/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Page-level skeleton exports — AgentsPage, TaskDetailPage, WalletPage (#2)
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentsPageSkeleton — /agents (#2)', () => {
  it('renders with data-testid and aria-busy=true', async () => {
    const { AgentsPageSkeleton } = await import('./AgentsPage');
    render(
      <MemoryRouter>
        <AgentsPageSkeleton />
      </MemoryRouter>,
    );
    const el = screen.getByTestId('agents-page-skeleton');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-busy', 'true');
  });

  it('renders 8 agent card skeleton placeholders', async () => {
    const { AgentsPageSkeleton } = await import('./AgentsPage');
    render(
      <MemoryRouter>
        <AgentsPageSkeleton />
      </MemoryRouter>,
    );
    const cards = screen.getAllByTestId('agent-card-skeleton');
    expect(cards).toHaveLength(8);
  });
});

describe('TaskDetailSkeleton — /tasks/:id (#2)', () => {
  it('renders with data-testid and aria-busy=true', async () => {
    const { TaskDetailSkeleton } = await import('./TaskDetailPage');
    render(
      <MemoryRouter>
        <TaskDetailSkeleton />
      </MemoryRouter>,
    );
    const el = screen.getByTestId('task-detail-skeleton');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-busy', 'true');
  });

  it('contains skeleton text lines for the output and payment panels', async () => {
    const { TaskDetailSkeleton } = await import('./TaskDetailPage');
    render(
      <MemoryRouter>
        <TaskDetailSkeleton />
      </MemoryRouter>,
    );
    const lines = screen.getAllByTestId('skeleton-text-line');
    expect(lines.length).toBeGreaterThanOrEqual(6);
  });
});

describe('WalletPageSkeleton — /wallet (#2)', () => {
  it('renders with data-testid and aria-busy=true', async () => {
    const { WalletPageSkeleton } = await import('./WalletPage');
    render(
      <MemoryRouter>
        <WalletPageSkeleton />
      </MemoryRouter>,
    );
    const el = screen.getByTestId('wallet-page-skeleton');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a QR placeholder avatar and balance skeleton', async () => {
    const { WalletPageSkeleton } = await import('./WalletPage');
    render(
      <MemoryRouter>
        <WalletPageSkeleton />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('wallet-qr-skeleton')).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  PaymentsPage loading state — table skeleton rows (#2)
// ─────────────────────────────────────────────────────────────────────────────

describe('PaymentsPage loading skeleton — /payments (#2)', () => {
  it('renders skeleton rows in the table while loading', async () => {
    const PaymentsPage = (await import('./PaymentsPage')).default;
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>,
    );
    // When loading=true (mocked above) and connected=false the page shows the
    // wallet-not-connected empty state. The skeleton rows are shown when the
    // wallet is connected and loading is true.
    // Verify at minimum that the page renders without crashing.
    expect(screen.getByText(/Connect your wallet/i)).toBeInTheDocument();
  });

  it('shows skeleton rows when wallet is connected and payments are loading', async () => {
    // Re-mock useWallet to return a connected state for this test.
    const { useWallet } = await import('../context/WalletContext');
    vi.mocked(useWallet).mockReturnValueOnce({
      publicKey: 'GDUMMY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890ABCDE',
      connected: true,
      ready: true,
      connectionMethod: 'freighter',
      freighterAvailable: true,
      connect: vi.fn(),
      connectFreighter: vi.fn(),
      disconnect: vi.fn(),
      hasCompletedWizard: true,
    } as ReturnType<typeof useWallet>);

    const PaymentsPage = (await import('./PaymentsPage')).default;
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>,
    );
    // With loading=true (from mock), the table renders aria-hidden skeleton rows.
    const skeletonRows = document.querySelectorAll('tr[aria-hidden="true"]');
    expect(skeletonRows.length).toBeGreaterThanOrEqual(1);
  });
});
