import Joyride, { type TooltipRenderProps } from 'react-joyride';
import { useOnboarding } from '../../context/OnboardingContext';
import styles from './OnboardingTour.module.css';

function TourTooltip({ index, size, isLastStep, step, tooltipProps, backProps, primaryProps, skipProps }: TooltipRenderProps) {
  return (
    <div {...tooltipProps} className={styles.tooltip}>
      <strong>{step.title}</strong>
      <p>{step.content}</p>
      <div className={styles.controls}>
        <span aria-live="polite">{index + 1} of {size}</span>
        <button {...skipProps} type="button">Skip</button>
        <button {...backProps} type="button" disabled={index === 0}>Back</button>
        <button {...primaryProps} type="button">{isLastStep ? 'Finish' : 'Next'}</button>
      </div>
    </div>
  );
}

export default function OnboardingTour() {
  const tour = useOnboarding();
  if (!tour) return null;

  return (
    <Joyride
      key={tour.session}
      run={tour.run}
      stepIndex={tour.stepIndex}
      steps={tour.steps}
      callback={tour.handleEvent}
      tooltipComponent={TourTooltip}
      continuous
      showSkipButton
      disableOverlayClose
      spotlightClicks
      styles={{
        options: { zIndex: 1500 },
        overlay: { pointerEvents: 'none' },
      }}
    />
  );
}
