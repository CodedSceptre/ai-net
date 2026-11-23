import { createContext, useContext, type ReactNode } from 'react';
import { useOnboardingTour } from '../hooks/useOnboardingTour';

const OnboardingContext = createContext<ReturnType<typeof useOnboardingTour> | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const tour = useOnboardingTour();
  return <OnboardingContext.Provider value={tour}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
