import { useCallback, useState } from 'react';
import { ACTIONS, EVENTS, STATUS, type CallBackProps, type Step } from 'react-joyride';

export const TOUR_COMPLETED_KEY = 'ainet_tour_completed';

const steps: Step[] = [
  { target: '#btn-connect-wallet, #wallet-pubkey-display', title: 'Wallet', content: 'Connect your Freighter wallet to get started' },
  { target: '[data-tour-nav="/agents"]', title: 'Agent browser', content: 'Browse available AI agents and their capabilities' },
  { target: '[data-tour-nav="/tasks/new"]', title: 'New task', content: 'Submit a new task prompt with a budget for agents to complete' },
  { target: '#tour-dashboard-metrics', title: 'Dashboard metrics', content: 'Track your overall activity, spending, and agent performance' },
  { target: '.notification-bell-btn', title: 'Notifications', content: 'Get notified when tasks complete or payments are received' },
  { target: '[data-tour-nav="/payments"]', title: 'Payment history', content: 'Review your full transaction history and export receipts' },
].map((step) => ({ ...step, disableBeacon: true }));

function shouldStart() {
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === null;
  } catch {
    return true;
  }
}

export function useOnboardingTour() {
  const [run, setRun] = useState(shouldStart);
  const [stepIndex, setStepIndex] = useState(0);
  const [session, setSession] = useState(0);

  const startTour = useCallback(() => {
    try {
      localStorage.removeItem(TOUR_COMPLETED_KEY);
    } catch {
      // The tour still works when browser storage is unavailable.
    }
    setStepIndex(0);
    setSession((previous) => previous + 1);
    setRun(true);
  }, []);

  const handleEvent = useCallback(({ action, index, status, type }: CallBackProps) => {
    const finished = type === EVENTS.STEP_AFTER && action === ACTIONS.NEXT && index === steps.length - 1;
    if (finished || status === STATUS.FINISHED || status === STATUS.SKIPPED || action === ACTIONS.CLOSE) {
      setRun(false);
      try {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
      } catch {
        // The tour remains stopped for the current session.
      }
    } else if (type === EVENTS.STEP_AFTER) {
      setStepIndex(Math.max(0, Math.min(steps.length - 1, index + (action === ACTIONS.PREV ? -1 : 1))));
    }
  }, []);

  return { run, stepIndex, session, startTour, steps, handleEvent };
}
