import { VeniceCircuitBreaker } from './veniceCircuitBreaker';
import { CircuitOpenError } from './venice/errors';
import { veniceConfigSchema } from '../config/venice';

// ---------------------------------------------------------------------------
// getStatus()
// ---------------------------------------------------------------------------

describe('VeniceCircuitBreaker — getStatus()', () => {
  it('returns CLOSED state with zero failures and null timestamps initially', () => {
    const breaker = new VeniceCircuitBreaker({ now: () => 10_000 });
    const status = breaker.getStatus();

    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
    expect(status.lastFailureAt).toBeNull();
    expect(status.nextAttemptAt).toBeNull();
  });

  it('returns null nextAttemptAt when CLOSED', () => {
    const breaker = new VeniceCircuitBreaker({ now: () => 5_000 });
    breaker.recordFailure();
    expect(breaker.getStatus().nextAttemptAt).toBeNull();
  });

  it('returns OPEN state with correct failureCount and nextAttemptAt after threshold', () => {
    let now = 1_000;
    const breaker = new VeniceCircuitBreaker({
      failureThreshold: 5,
      openDurationMs: 30_000,
      now: () => now,
    });

    for (let i = 0; i < 5; i++) {
      now += 100;
      breaker.recordFailure();
    }

    const status = breaker.getStatus();
    expect(status.state).toBe('OPEN');
    expect(status.failureCount).toBe(5);
    // nextAttemptAt = openedAt + openDurationMs; openedAt is set when open() is called
    expect(typeof status.nextAttemptAt).toBe('number');
    expect(status.nextAttemptAt).toBeGreaterThan(now);
  });

  it('returns lastFailureAt matching the most recent failure timestamp', () => {
    const timestamps = [1_000, 2_000, 3_000, 4_000];
    let callCount = 0;
    const nowFn = () => timestamps[callCount++] ?? timestamps[timestamps.length - 1]!;
    const breaker = new VeniceCircuitBreaker({ failureThreshold: 10, now: nowFn });

    for (let i = 0; i < 4; i++) breaker.recordFailure();

    // The last failure recorded was at timestamp index 3 → 4_000
    expect(breaker.getStatus().lastFailureAt).toBe(4_000);
  });

  it('returns null nextAttemptAt when HALF_OPEN', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({ now: () => now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    now = 30_001; // past recovery window
    expect(breaker.getStatus().state).toBe('HALF_OPEN');
    expect(breaker.getStatus().nextAttemptAt).toBeNull();
  });

  it('reports failureCount of 0 and lastFailureAt null after CLOSED recovery', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({ now: () => now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    now = 30_001;
    breaker.getState(); // triggers HALF_OPEN
    breaker.recordSuccess();
    breaker.recordSuccess();

    const status = breaker.getStatus();
    expect(status.state).toBe('CLOSED');
    expect(status.failureCount).toBe(0);
    expect(status.lastFailureAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe('VeniceCircuitBreaker — state transitions', () => {
  it('transitions CLOSED → OPEN after threshold failures within window', () => {
    const breaker = new VeniceCircuitBreaker({ now: () => 10_000 });

    for (let i = 0; i < 4; i++) breaker.recordFailure();
    expect(breaker.getState()).toBe('CLOSED');

    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
  });

  it('assertClosed throws CircuitOpenError when OPEN', () => {
    const breaker = new VeniceCircuitBreaker({ now: () => 10_000 });
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    expect(() => breaker.assertClosed()).toThrow(CircuitOpenError);
  });

  it('does not record additional failures while OPEN', () => {
    let now = 10_000;
    const breaker = new VeniceCircuitBreaker({ now: () => now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    // Extra failures while open should be silently ignored
    breaker.recordFailure();
    breaker.recordFailure();

    // After recovery window the failure count is from before open
    now = 10_000 + 30_001;
    expect(breaker.getState()).toBe('HALF_OPEN');
    expect(breaker.getFailureCount()).toBe(5);
  });

  it('transitions OPEN → HALF_OPEN after recovery window elapses', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({ openDurationMs: 30_000, now: () => now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();

    expect(breaker.getState()).toBe('OPEN');

    now = 30_000; // exactly at the boundary — transition triggers (>=)
    expect(breaker.getState()).toBe('HALF_OPEN');
  });

  it('transitions HALF_OPEN → CLOSED after required consecutive successes', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({
      halfOpenSuccessThreshold: 2,
      now: () => now,
    });
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    now = 30_001;
    breaker.getState(); // enter HALF_OPEN

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('HALF_OPEN'); // one success — not enough yet
    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('transitions HALF_OPEN → OPEN on probe failure', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({ now: () => now });
    for (let i = 0; i < 5; i++) breaker.recordFailure();
    now = 30_001;
    breaker.getState(); // enter HALF_OPEN

    breaker.recordFailure();
    expect(breaker.getState()).toBe('OPEN');
  });

  it('failures outside the window do not count towards threshold', () => {
    let now = 0;
    const breaker = new VeniceCircuitBreaker({
      failureThreshold: 5,
      failureWindowMs: 60_000,
      now: () => now,
    });

    for (let i = 0; i < 4; i++) breaker.recordFailure();
    now = 60_001; // all previous failures expire
    breaker.recordFailure(); // only 1 failure in window

    expect(breaker.getState()).toBe('CLOSED');
    expect(breaker.getFailureCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// veniceConfigSchema
// ---------------------------------------------------------------------------

describe('veniceConfigSchema', () => {
  it('rejects when VENICE_API_KEY is absent', () => {
    expect(() =>
      veniceConfigSchema.parse({ VENICE_API_KEY: undefined }),
    ).toThrow();
  });

  it('rejects when VENICE_API_KEY is an empty string', () => {
    expect(() =>
      veniceConfigSchema.parse({ VENICE_API_KEY: '' }),
    ).toThrow(/VENICE_API_KEY is required/);
  });

  it('rejects when VENICE_BASE_URL is not a valid URL', () => {
    expect(() =>
      veniceConfigSchema.parse({ VENICE_API_KEY: 'some-key', VENICE_BASE_URL: 'not-a-url' }),
    ).toThrow(/valid URL/);
  });

  it('applies the default VENICE_BASE_URL when the variable is absent', () => {
    const result = veniceConfigSchema.parse({ VENICE_API_KEY: 'test-key' });
    expect(result.VENICE_BASE_URL).toBe('https://api.venice.ai/api/v1');
  });

  it('applies the default VENICE_REQUEST_TIMEOUT_MS of 30 000', () => {
    const result = veniceConfigSchema.parse({ VENICE_API_KEY: 'test-key' });
    expect(result.VENICE_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('applies the default VENICE_CIRCUIT_FAILURE_THRESHOLD of 5', () => {
    const result = veniceConfigSchema.parse({ VENICE_API_KEY: 'test-key' });
    expect(result.VENICE_CIRCUIT_FAILURE_THRESHOLD).toBe(5);
  });

  it('applies the default VENICE_CIRCUIT_RECOVERY_WINDOW_MS of 30 000', () => {
    const result = veniceConfigSchema.parse({ VENICE_API_KEY: 'test-key' });
    expect(result.VENICE_CIRCUIT_RECOVERY_WINDOW_MS).toBe(30_000);
  });

  it('coerces string env-var values to numbers', () => {
    const result = veniceConfigSchema.parse({
      VENICE_API_KEY: 'test-key',
      VENICE_REQUEST_TIMEOUT_MS: '15000',
      VENICE_PROVIDER_MAX_RETRIES: '3',
    });
    expect(result.VENICE_REQUEST_TIMEOUT_MS).toBe(15_000);
    expect(result.VENICE_PROVIDER_MAX_RETRIES).toBe(3);
  });

  it('rejects VENICE_PROVIDER_MAX_RETRIES above 10', () => {
    expect(() =>
      veniceConfigSchema.parse({ VENICE_API_KEY: 'test-key', VENICE_PROVIDER_MAX_RETRIES: '11' }),
    ).toThrow();
  });

  it('accepts a fully specified valid configuration', () => {
    const result = veniceConfigSchema.parse({
      VENICE_API_KEY: 'sk-test-abc123',
      VENICE_BASE_URL: 'https://custom.venice.ai/api/v2',
      VENICE_REQUEST_TIMEOUT_MS: '20000',
      VENICE_PROVIDER_MAX_RETRIES: '3',
      VENICE_CIRCUIT_FAILURE_THRESHOLD: '10',
      VENICE_CIRCUIT_RECOVERY_WINDOW_MS: '60000',
      VENICE_CIRCUIT_FAILURE_WINDOW_MS: '120000',
    });

    expect(result).toEqual({
      VENICE_API_KEY: 'sk-test-abc123',
      VENICE_BASE_URL: 'https://custom.venice.ai/api/v2',
      VENICE_REQUEST_TIMEOUT_MS: 20_000,
      VENICE_PROVIDER_MAX_RETRIES: 3,
      VENICE_CIRCUIT_FAILURE_THRESHOLD: 10,
      VENICE_CIRCUIT_RECOVERY_WINDOW_MS: 60_000,
      VENICE_CIRCUIT_FAILURE_WINDOW_MS: 120_000,
    });
  });
});
