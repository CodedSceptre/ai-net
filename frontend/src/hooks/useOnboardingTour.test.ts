import { act, renderHook } from '@testing-library/react';
import { ACTIONS, EVENTS, STATUS, type CallBackProps } from 'react-joyride';
import { beforeEach, describe, expect, it } from 'vitest';
import { TOUR_COMPLETED_KEY, useOnboardingTour } from './useOnboardingTour';

function event(fields: Partial<CallBackProps> = {}): CallBackProps {
  return {
    action: ACTIONS.NEXT,
    index: 0,
    status: STATUS.RUNNING,
    type: EVENTS.STEP_AFTER,
    ...fields,
  } as CallBackProps;
}

describe('useOnboardingTour', () => {
  beforeEach(() => localStorage.removeItem(TOUR_COMPLETED_KEY));

  it('starts at step one on the first visit', () => {
    const { result } = renderHook(useOnboardingTour);
    expect(result.current.run).toBe(true);
    expect(result.current.stepIndex).toBe(0);
    expect(result.current.steps).toHaveLength(6);
  });

  it('persists a skip and clears it when restarted', () => {
    const first = renderHook(useOnboardingTour);
    act(() => first.result.current.handleEvent(event({ status: STATUS.SKIPPED })));
    expect(first.result.current.run).toBe(false);
    expect(localStorage.getItem(TOUR_COMPLETED_KEY)).toBe('true');
    first.unmount();

    const { result } = renderHook(useOnboardingTour);
    expect(result.current.run).toBe(false);
    act(() => result.current.startTour());
    expect(localStorage.getItem(TOUR_COMPLETED_KEY)).toBeNull();
    expect(result.current.run).toBe(true);
    expect(result.current.stepIndex).toBe(0);
  });

  it('progresses forward and back and records completion', () => {
    const { result } = renderHook(useOnboardingTour);
    act(() => result.current.handleEvent(event()));
    expect(result.current.stepIndex).toBe(1);
    act(() => result.current.handleEvent(event({ index: 1, action: ACTIONS.PREV })));
    expect(result.current.stepIndex).toBe(0);
    act(() => result.current.handleEvent(event({ index: 5 })));
    expect(result.current.run).toBe(false);
    expect(localStorage.getItem(TOUR_COMPLETED_KEY)).toBe('true');
  });
});
