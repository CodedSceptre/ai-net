/**
 * AgentMatcher — capability-based agent selection for the coordinator.
 *
 * When a node in a task DAG needs an agent, the coordinator asks the matcher
 * for the best candidate that offers the required capability.  Selection is
 * deterministic and price-aware so task execution cost is predictable:
 *
 *   1. Filter to agents whose `status` is `'online'`.
 *   2. Filter to agents whose `capabilities` match the requested capability —
 *      exact match first, then a case-insensitive, dot-delimited prefix match
 *      (e.g. `'text'` matches `'text.summarize'` but not `'textual'`).
 *   3. Sort survivors by priceXLM ASC, then reputationScore DESC, then
 *      avgResponseTimeMs ASC, and return the top entry.
 *
 * The matcher is intentionally decoupled from any particular registry storage:
 * it operates on an injected {@link AgentSource} (a static array or a
 * function returning one), so it can be wired to the on-chain-synced
 * `agents` table, an in-memory fixture, or a test double.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lifecycle states an agent can be in.  Only `'online'` is selectable. */
export type AgentStatus = 'online' | 'offline' | 'deregistered';

/**
 * The slice of an agent record that the matcher cares about.  This mirrors the
 * fields persisted in the `agents` table (`pricingXLM`, `reputationScore`,
 * `capabilities`, `status`) and adds `avgResponseTimeMs`, which the matcher
 * uses as the final tiebreaker and which is sourced from agent metrics.
 */
export interface MatcherAgent {
  /** Unique agent identifier (mirrors `agents.id`). */
  id: string;
  /** Capabilities the agent offers, e.g. `['text.summarize', 'text.translate']`. */
  capabilities: string[];
  /** Price per invocation in XLM (mirrors `agents.pricingXLM`). */
  priceXLM: number;
  /** Reputation in the range [0, 5]; higher is better. */
  reputationScore: number;
  /** Mean agent response time in milliseconds; lower is better. */
  avgResponseTimeMs: number;
  /** Only `'online'` agents are ever returned by any method. */
  status: AgentStatus;
}

/**
 * Optional request-level hints forwarded to the matcher.  Currently unused —
 * reserved for future filtering by preferred language or geographic region.
 * Callers may pass it freely; it is ignored when not relevant.
 */
export interface MatchContext {
  /** Preferred response language, e.g. `'en'`, `'fr'`. */
  preferredLanguage?: string;
  /** Preferred geographic region, e.g. `'eu-west-1'`. */
  region?: string;
}

/**
 * Where the matcher draws its candidate pool from.  Accepts a static array
 * (tests, in-memory fixtures) or a zero-arg function returning an array or a
 * promise of one (the live registry, which may read from a DB or the network).
 */
export type AgentSource =
  | readonly MatcherAgent[]
  | (() => readonly MatcherAgent[] | Promise<readonly MatcherAgent[]>);

// ---------------------------------------------------------------------------
// Capability matching
// ---------------------------------------------------------------------------

/**
 * Decide whether `agent` offers `capability`.
 *
 * Matching is case-insensitive and works in two phases:
 *   1. Exact match against any of the agent's capabilities.
 *   2. Dot-delimited prefix match — `'text'` matches `'text.summarize'` and
 *      `'text.translate'` but NOT `'textual'` (the prefix must end at a `.`).
 *
 * Exact matches are preferred because they are more specific, but the matcher
 * does not need to know which phase hit — both are valid matches.
 */
export function capabilityMatches(capability: string, agent: MatcherAgent): boolean {
  const wanted = capability.toLowerCase();
  const caps = agent.capabilities ?? [];

  // Phase 1 — exact (case-insensitive).
  if (caps.some((c) => c.toLowerCase() === wanted)) {
    return true;
  }

  // Phase 2 — prefix at the dot boundary.
  return caps.some((c) => {
    const cl = c.toLowerCase();
    return cl === wanted || cl.startsWith(`${wanted}.`);
  });
}

// ---------------------------------------------------------------------------
// Comparator
// ---------------------------------------------------------------------------

/**
 * Deterministic sort order for candidate agents:
 *   • priceXLM ascending  (cheapest first)
 *   • reputationScore descending (better reputation wins ties)
 *   • avgResponseTimeMs ascending (faster wins further ties)
 *
 * Returns a NEW sorted array; the input is never mutated.
 */
export function rankAgents(candidates: readonly MatcherAgent[]): MatcherAgent[] {
  return [...candidates].sort((a, b) => {
    if (a.priceXLM !== b.priceXLM) {
      return a.priceXLM - b.priceXLM;
    }
    if (a.reputationScore !== b.reputationScore) {
      return b.reputationScore - a.reputationScore; // DESC
    }
    return a.avgResponseTimeMs - b.avgResponseTimeMs; // ASC
  });
}

// ---------------------------------------------------------------------------
// AgentMatcher
// ---------------------------------------------------------------------------

/**
 * Stateful selector over an {@link AgentSource}.  Every method filters out
 * non-online agents and applies capability matching before ranking.
 */
export class AgentMatcher {
  constructor(private readonly source: AgentSource) {}

  /** Resolve the current candidate pool from the source. */
  private async pool(): Promise<readonly MatcherAgent[]> {
    const resolved =
      typeof this.source === 'function' ? await this.source() : this.source;
    return resolved ?? [];
  }

  /**
   * Online agents that offer `capability`, ranked by the canonical priority
   * order, optionally excluding `excludeAgentId`.
   */
  private async ranked(
    capability: string,
    excludeAgentId?: string
  ): Promise<MatcherAgent[]> {
    const all = await this.pool();
    const online = all.filter((a) => a.status === 'online');
    const matched = online.filter((a) => capabilityMatches(capability, a));
    const filtered =
      excludeAgentId !== undefined
        ? matched.filter((a) => a.id !== excludeAgentId)
        : matched;
    return rankAgents(filtered);
  }

  /**
   * Return the best online agent for `capability`, or `null` if none match.
   *
   * `context` carries optional request-level hints (language, region) for
   * future filtering extensions; it is currently ignored when absent.
   */
  async findBestAgent(
    capability: string,
    context?: MatchContext
  ): Promise<MatcherAgent | null> {
    void context; // reserved for future filtering extensions
    const ranked = await this.ranked(capability);
    return ranked[0] ?? null;
  }

  /**
   * Return the online agent with the lowest `priceXLM` for `capability`, or
   * `null`.  Used by the {@link CostEstimator} for price projections.
   *
   * Because the canonical ranking orders by priceXLM first, the cheapest
   * agent is the same as the best agent for a given capability.
   */
  async findCheapest(capability: string): Promise<MatcherAgent | null> {
    const ranked = await this.ranked(capability);
    return ranked[0] ?? null;
  }

  /**
   * Return the best online agent for `capability` excluding `excludeAgentId`,
   * or `null`.  Used by the retry/failover path when the primary agent has
   * failed mid-task and the coordinator needs the next-best option.
   */
  async findFallback(
    capability: string,
    excludeAgentId: string
  ): Promise<MatcherAgent | null> {
    const ranked = await this.ranked(capability, excludeAgentId);
    return ranked[0] ?? null;
  }

  /**
   * Return every online agent that offers `capability`, ranked by the
   * canonical priority order.  Used to populate the agent-discovery UI.
   */
  async findAll(capability: string): Promise<MatcherAgent[]> {
    return this.ranked(capability);
  }
}
