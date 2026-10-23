import { VeniceCircuitBreaker, type VeniceCircuitState } from '../veniceCircuitBreaker.js';

export type CircuitState = VeniceCircuitState;

/** @deprecated Use VeniceCircuitBreaker. Kept for existing client integrations. */
export class CircuitBreaker extends VeniceCircuitBreaker {
  constructor(nowFn?: () => number) {
    super({ now: nowFn });
  }
}
