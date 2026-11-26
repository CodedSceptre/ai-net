/**
 * EmptyState.stories.tsx
 *
 * NOTE: Storybook is not installed in this project (@storybook/* packages are
 * absent from frontend/package.json). This file is a STUB that documents
 * component usage and serves as ready-to-use stories once Storybook is added.
 *
 * To enable these stories:
 *   npx storybook@latest init   # inside frontend/
 *
 * ---------------------------------------------------------------------------
 * Component: EmptyState
 * Covers all 6 illustrated empty states required by issue #735.
 * ---------------------------------------------------------------------------
 */

import { MemoryRouter } from 'react-router-dom';
import { EmptyState } from './EmptyState';

import NoTasksIllustration from '../../assets/illustrations/NoTasks.svg';
import NoAgentsIllustration from '../../assets/illustrations/NoAgents.svg';
import NoPaymentsIllustration from '../../assets/illustrations/NoPayments.svg';
import NoNotificationsIllustration from '../../assets/illustrations/NoNotifications.svg';
import NoResultsIllustration from '../../assets/illustrations/NoResults.svg';
import WalletNotConnectedIllustration from '../../assets/illustrations/WalletNotConnected.svg';

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>
    <div style={{ maxWidth: 480, margin: '2rem auto', fontFamily: 'sans-serif' }}>{node}</div>
  </MemoryRouter>
);

// 1 ── No tasks yet
export function NoTasks() {
  return wrap(
    <EmptyState
      illustration={NoTasksIllustration}
      title="No tasks yet"
      description="Submit your first task and let agents do the work."
      primaryAction={{ label: 'Submit Your First Task', to: '/tasks/new' }}
    />
  );
}

// 2 ── No agents registered
export function NoAgents() {
  return wrap(
    <EmptyState
      illustration={NoAgentsIllustration}
      title="No agents registered"
      description="Browse the marketplace and register your first AI agent."
      primaryAction={{ label: 'Browse Agents', to: '/agents' }}
    />
  );
}

// 3 ── No payments
export function NoPayments() {
  return wrap(
    <EmptyState
      illustration={NoPaymentsIllustration}
      title="No payments yet"
      description="Payments will appear here once you complete a task."
      primaryAction={{ label: 'Submit a Task', to: '/tasks/new' }}
    />
  );
}

// 4 ── No notifications
export function NoNotifications() {
  return wrap(
    <EmptyState
      illustration={NoNotificationsIllustration}
      title="All caught up"
      description="You have no new notifications at the moment."
    />
  );
}

// 5 ── Search returned no results
export function NoSearchResults() {
  return wrap(
    <EmptyState
      illustration={NoResultsIllustration}
      title="No results found"
      description="Try adjusting your filters or searching with different keywords."
      primaryAction={{ label: 'Clear Filters', onClick: () => alert('filters cleared') }}
    />
  );
}

// 6 ── Wallet not connected
export function WalletNotConnected() {
  return wrap(
    <EmptyState
      illustration={WalletNotConnectedIllustration}
      title="Wallet not connected"
      description="Connect your Stellar wallet to submit tasks and receive payments."
      primaryAction={{ label: 'Connect Wallet', onClick: () => alert('connect wallet') }}
    />
  );
}

// ── Animated variant (default)
export function AnimatedEntrance() {
  return wrap(
    <EmptyState
      illustration={NoTasksIllustration}
      title="Animated empty state"
      description="This state fades and slides up on first render."
      animated
      primaryAction={{ label: 'Get Started', onClick: () => {} }}
    />
  );
}

// ── Card variant
export function CardVariant() {
  return wrap(
    <EmptyState
      illustration={NoAgentsIllustration}
      title="No agents registered"
      description="Register an agent to start earning on the network."
      variant="card"
      primaryAction={{ label: 'Register Agent', to: '/agents/register' }}
    />
  );
}

// ── Compact variant
export function CompactVariant() {
  return wrap(
    <EmptyState
      illustration={NoResultsIllustration}
      title="No results found"
      description="Try a different search term."
      variant="compact"
      primaryAction={{ label: 'Clear Search', onClick: () => {} }}
    />
  );
}

// ── onAction shorthand
export function ShorthandAction() {
  return wrap(
    <EmptyState
      illustration={NoTasksIllustration}
      title="Nothing here yet"
      description="Use the shorthand onAction prop to handle clicks."
      onAction={() => alert('action fired')}
      actionLabel="Take Action"
    />
  );
}
