/**
 * SequenceNumberManager — per-account promise-chain mutex for Stellar submissions.
 *
 * Stellar accounts have a monotonically-incrementing sequence number. When two
 * transactions are built from the same account concurrently they both read the
 * same sequence number and one of them will fail with `tx_bad_seq`. Serialising
 * all submissions for a given public key through a promise chain solves this at
 * zero CPU cost: there are no timers, no polling, and no blocking — each caller
 * simply awaits the previous caller's promise before proceeding.
 *
 * Usage:
 *   const mgr = new SequenceNumberManager();
 *   const result = await mgr.withAccount(publicKey, async () => {
 *     const account = await server.loadAccount(publicKey);
 *     const tx = buildTx(account);
 *     return server.submitTransaction(tx);
 *   });
 */
export class SequenceNumberManager {
  /**
   * Tracks the tail of each account's execution queue.
   * Key   : Stellar public key (G…)
   * Value : promise that resolves when the current head of the queue finishes.
   */
  private locks = new Map<string, Promise<unknown>>();

  /**
   * Enqueue `fn` for `publicKey`.  `fn` will not start until every previously
   * enqueued function for the same key has settled.
   *
   * @param publicKey  Stellar public key identifying the source account.
   * @param fn         Async work to serialize (load account → build → submit).
   * @returns          Whatever `fn` resolves with.
   */
  withAccount<T>(publicKey: string, fn: () => Promise<T>): Promise<T> {
    // Preserve FIFO ordering per source account by chaining each task behind the
    // previous task and only releasing the next caller once the current result has
    // actually been consumed by a .then/.catch/await handler.
    const previous = this.locks.get(publicKey) ?? Promise.resolve();
    const queued = previous.then(() => fn());

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    // Publish the gate as the current tail so the next caller won't proceed until
    // the previous task's result has been handled.
    this.locks.set(publicKey, gate);

    const finalize = () => {
      release();
      if (this.locks.get(publicKey) === gate) {
        this.locks.delete(publicKey);
      }
    };

    const wrapped: Promise<T> = {
      then: (onFulfilled, onRejected) =>
        queued.then(
          (value) => {
            const next: any = onFulfilled ? onFulfilled(value) : value;
            finalize();
            return next;
          },
          (error) => {
            const next: any = onRejected ? onRejected(error) : Promise.reject(error);
            finalize();
            return next;
          }
        ),
      catch: (onRejected) =>
        queued.catch((error) => {
          const next: any = onRejected ? onRejected(error) : Promise.reject(error);
          finalize();
          return next;
        }),
      finally: (onFinally) =>
        queued.finally(() => {
          const next: any = onFinally ? onFinally() : undefined;
          finalize();
          return next;
        }),
    } as Promise<T>;

    return wrapped;
  }
}
