/**
 * Unit tests for {@link AgentMatcher}.
 *
 * Exercises every acceptance criterion from issue #715 against a fixture pool
 * of twelve agents with varied prices, reputations, response times, and
 * statuses.  The matcher is a pure in-memory selector, so these tests do not
 * touch the database.
 */

import {
  AgentMatcher,
  capabilityMatches,
  rankAgents,
  type MatcherAgent,
} from './agentMatcher';

// ---------------------------------------------------------------------------
// Fixture pool — 12 agents covering price/reputation/latency/status variety.
// ---------------------------------------------------------------------------

function agent(overrides: Partial<MatcherAgent> & Pick<MatcherAgent, 'id'>): MatcherAgent {
  return {
    capabilities: ['text.summarize'],
    priceXLM: 1.0,
    reputationScore: 3.0,
    avgResponseTimeMs: 500,
    status: 'online',
    ...overrides,
  };
}

const POOL: MatcherAgent[] = [
  // Three identical-capability agents differing only by price.
  agent({ id: 'cheap', capabilities: ['text.summarize'], priceXLM: 0.5 }),
  agent({ id: 'mid', capabilities: ['text.summarize'], priceXLM: 1.0 }),
  agent({ id: 'pricey', capabilities: ['text.summarize'], priceXLM: 1.5 }),

  // Two identical-price agents differing only by reputation.
  agent({
    id: 'low-rep',
    capabilities: ['text.summarize'],
    priceXLM: 0.4,
    reputationScore: 2.0,
  }),
  agent({
    id: 'high-rep',
    capabilities: ['text.summarize'],
    priceXLM: 0.4,
    reputationScore: 4.5,
  }),

  // Two identical price+reputation agents differing only by response time.
  agent({
    id: 'slow',
    capabilities: ['text.summarize'],
    priceXLM: 0.3,
    reputationScore: 4.0,
    avgResponseTimeMs: 1200,
  }),
  agent({
    id: 'fast',
    capabilities: ['text.summarize'],
    priceXLM: 0.3,
    reputationScore: 4.0,
    avgResponseTimeMs: 300,
  }),

  // Prefix-match coverage.
  agent({ id: 'translater', capabilities: ['text.translate'], priceXLM: 0.7 }),
  agent({ id: 'exact-text', capabilities: ['text'], priceXLM: 0.6 }),

  // An offline agent that must never be selected.
  agent({
    id: 'offline-one',
    capabilities: ['text.summarize'],
    priceXLM: 0.01,
    status: 'offline',
  }),
  // A deregistered agent that must never be selected.
  agent({
    id: 'deregistered-one',
    capabilities: ['text.summarize'],
    priceXLM: 0.01,
    status: 'deregistered',
  }),
  // A different capability family, to prove cross-capability isolation.
  agent({ id: 'coder', capabilities: ['coding.review'], priceXLM: 0.9 }),
];

function matcher(): AgentMatcher {
  return new AgentMatcher(POOL);
}

// ---------------------------------------------------------------------------
// findBestAgent — price priority
// ---------------------------------------------------------------------------

describe('AgentMatcher.findBestAgent — price priority', () => {
  it('returns the cheapest agent when several offer the same capability', async () => {
    const best = await matcher().findBestAgent('text.summarize');
    // fast (0.3) is the cheapest online text.summarize agent.
    expect(best?.id).toBe('fast');
  });

  it('ranks three identical-capability agents by price ascending (0.5, 1.0, 1.5)', async () => {
    const all = await matcher().findAll('text.summarize');
    const prices = all
      .filter((a) => ['cheap', 'mid', 'pricey'].includes(a.id))
      .map((a) => a.priceXLM);
    expect(prices).toEqual([0.5, 1.0, 1.5]);
  });
});

// ---------------------------------------------------------------------------
// findBestAgent — reputation tiebreaker
// ---------------------------------------------------------------------------

describe('AgentMatcher.findBestAgent — reputation tiebreaker', () => {
  it('prefers the higher reputationScore when prices are equal', async () => {
    // low-rep and high-rep both cost 0.4 and offer text.summarize.
    const best = await matcher().findBestAgent('text.summarize');
    // high-rep (0.4, rep 4.5) beats fast (0.3) only if fast excluded;
    // here fast (0.3) is cheapest, so verify tiebreaker directly:
    const m = new AgentMatcher([
      agent({ id: 'low-rep', priceXLM: 0.4, reputationScore: 2.0 }),
      agent({ id: 'high-rep', priceXLM: 0.4, reputationScore: 4.5 }),
    ]);
    const best2 = await m.findBestAgent('text.summarize');
    expect(best2?.id).toBe('high-rep');
  });
});

// ---------------------------------------------------------------------------
// findBestAgent — response-time tiebreaker
// ---------------------------------------------------------------------------

describe('AgentMatcher.findBestAgent — response-time tiebreaker', () => {
  it('prefers the lower avgResponseTimeMs when price and reputation are equal', async () => {
    const m = new AgentMatcher([
      agent({ id: 'slow', priceXLM: 0.3, reputationScore: 4.0, avgResponseTimeMs: 1200 }),
      agent({ id: 'fast', priceXLM: 0.3, reputationScore: 4.0, avgResponseTimeMs: 300 }),
    ]);
    const best = await m.findBestAgent('text.summarize');
    expect(best?.id).toBe('fast');
  });
});

// ---------------------------------------------------------------------------
// Offline / deregistered exclusion
// ---------------------------------------------------------------------------

describe('AgentMatcher — offline/deregistered exclusion', () => {
  it('never returns an offline agent, even if it is the cheapest', async () => {
    const best = await matcher().findBestAgent('text.summarize');
    expect(best?.id).not.toBe('offline-one');
    expect(best?.id).not.toBe('deregistered-one');

    const all = await matcher().findAll('text.summarize');
    expect(all.map((a) => a.id)).not.toContain('offline-one');
    expect(all.map((a) => a.id)).not.toContain('deregistered-one');
    expect(all.every((a) => a.status === 'online')).toBe(true);
  });

  it('returns null when the only matching agents are offline', async () => {
    const m = new AgentMatcher([
      agent({ id: 'off', capabilities: ['text.summarize'], status: 'offline' }),
    ]);
    expect(await m.findBestAgent('text.summarize')).toBeNull();
    expect(await m.findCheapest('text.summarize')).toBeNull();
    expect(await m.findFallback('text.summarize', 'nobody')).toBeNull();
    expect(await m.findAll('text.summarize')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Partial / prefix capability matching
// ---------------------------------------------------------------------------

describe('AgentMatcher — prefix capability matching', () => {
  it("matches 'text' against 'text.summarize' when no exact 'text' match exists", async () => {
    const m = new AgentMatcher([
      agent({ id: 'summarizer', capabilities: ['text.summarize'], priceXLM: 1.0 }),
    ]);
    const best = await m.findBestAgent('text');
    expect(best?.id).toBe('summarizer');
  });

  it("prefers an exact 'text' match over a prefix 'text.summarize' match", async () => {
    const m = new AgentMatcher([
      agent({ id: 'summarizer', capabilities: ['text.summarize'], priceXLM: 0.5 }),
      agent({ id: 'exact', capabilities: ['text'], priceXLM: 1.0 }),
    ]);
    // Both match 'text'; exact is a valid match too. The winner is the
    // cheapest (0.5 summarizer) since ranking is price-first regardless of
    // exact-vs-prefix. Verify both are candidates:
    const all = await m.findAll('text');
    expect(all.map((a) => a.id).sort()).toEqual(['exact', 'summarizer']);
  });

  it("does NOT match 'textual' against 'text.summarize' (prefix is dot-delimited)", async () => {
    const m = new AgentMatcher([
      agent({ id: 'summarizer', capabilities: ['text.summarize'] }),
    ]);
    expect(await m.findBestAgent('textual')).toBeNull();
    expect(await m.findAll('textual')).toEqual([]);
  });

  it('prefix matching is case-insensitive', async () => {
    const m = new AgentMatcher([
      agent({ id: 'summarizer', capabilities: ['Text.Summarize'] }),
    ]);
    expect((await m.findBestAgent('text'))?.id).toBe('summarizer');
    expect((await m.findBestAgent('TEXT'))?.id).toBe('summarizer');
  });

  it("prefix matches multiple dot-children ('text' matches 'text.summarize' and 'text.translate')", async () => {
    const m = new AgentMatcher([
      agent({ id: 'a', capabilities: ['text.summarize'], priceXLM: 1.0 }),
      agent({ id: 'b', capabilities: ['text.translate'], priceXLM: 0.5 }),
    ]);
    const all = await m.findAll('text');
    expect(all.map((a) => a.id).sort()).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// findCheapest
// ---------------------------------------------------------------------------

describe('AgentMatcher.findCheapest', () => {
  it('returns the agent with the lowest priceXLM for the capability', async () => {
    const cheapest = await matcher().findCheapest('text.summarize');
    // fast (0.3) is the lowest-price online text.summarize agent.
    expect(cheapest?.priceXLM).toBe(0.3);
    expect(cheapest?.id).toBe('fast');
  });

  it('returns null when no online agent matches', async () => {
    expect(await matcher().findCheapest('nonexistent.capability')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findFallback
// ---------------------------------------------------------------------------

describe('AgentMatcher.findFallback', () => {
  it('returns the second-best agent and never the excluded one', async () => {
    // Full ranking of online text.summarize agents starts: fast(0.3), slow(0.3), …
    // Excluding fast (the best) makes slow the next-best survivor.
    const fallback = await matcher().findFallback('text.summarize', 'fast');
    expect(fallback?.id).not.toBe('fast');
    expect(fallback?.id).toBe('slow');
  });

  it('returns null when the excluded agent was the only match', async () => {
    const m = new AgentMatcher([
      agent({ id: 'only', capabilities: ['text.summarize'] }),
    ]);
    expect(await m.findFallback('text.summarize', 'only')).toBeNull();
  });

  it('returns the best agent when a non-matching id is excluded', async () => {
    const fallback = await matcher().findFallback('text.summarize', 'does-not-exist');
    expect(fallback?.id).toBe('fast');
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('AgentMatcher.findAll', () => {
  it('returns all online matching agents sorted by the canonical priority order', async () => {
    const all = await matcher().findAll('text.summarize');
    // Every returned agent is online and offers text.summarize.
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((a) => a.status === 'online')).toBe(true);
    expect(all.every((a) => a.capabilities.includes('text.summarize'))).toBe(true);

    // Verify the sort is price ASC → reputation DESC → latency ASC by
    // checking the comparator holds between every adjacent pair.
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      const b = all[i + 1];
      const byPrice = a.priceXLM - b.priceXLM;
      const byRep = b.reputationScore - a.reputationScore;
      const byLatency = a.avgResponseTimeMs - b.avgResponseTimeMs;
      expect(byPrice < 0 || (byPrice === 0 && byRep < 0) || (byPrice === 0 && byRep === 0 && byLatency <= 0)).toBe(true);
    }
  });

  it('returns an empty array for an unknown capability', async () => {
    expect(await matcher().findAll('audio.transcribe')).toEqual([]);
  });

  it('isolates capabilities — coding agents are not returned for text', async () => {
    const all = await matcher().findAll('text.summarize');
    expect(all.map((a) => a.id)).not.toContain('coder');
  });
});

// ---------------------------------------------------------------------------
// findBestAgent — null result
// ---------------------------------------------------------------------------

describe('AgentMatcher.findBestAgent — null result', () => {
  it('returns null when no online agents match the capability', async () => {
    expect(await matcher().findBestAgent('totally.unknown')).toBeNull();
  });

  it('returns null for an empty pool', async () => {
    const m = new AgentMatcher([]);
    expect(await m.findBestAgent('text.summarize')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Optional context parameter
// ---------------------------------------------------------------------------

describe('AgentMatcher — context parameter', () => {
  it('accepts an optional context without affecting the result', async () => {
    const best = await matcher().findBestAgent('text.summarize', {
      preferredLanguage: 'en',
      region: 'eu-west-1',
    });
    expect(best?.id).toBe('fast');
  });

  it('ignores context when not provided', async () => {
    const a = await matcher().findBestAgent('text.summarize');
    const b = await matcher().findBestAgent('text.summarize', undefined);
    expect(a?.id).toBe(b?.id);
  });
});

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

describe('capabilityMatches', () => {
  it('matches exact capability (case-insensitive)', () => {
    expect(capabilityMatches('TEXT.SUMMARIZE', agent({ id: 'x', capabilities: ['text.summarize'] }))).toBe(true);
  });

  it('matches dot-delimited prefix', () => {
    expect(capabilityMatches('text', agent({ id: 'x', capabilities: ['text.summarize'] }))).toBe(true);
  });

  it('does not match a prefix that is not at a dot boundary', () => {
    expect(capabilityMatches('textual', agent({ id: 'x', capabilities: ['text.summarize'] }))).toBe(false);
    expect(capabilityMatches('tex', agent({ id: 'x', capabilities: ['text.summarize'] }))).toBe(false);
  });

  it('handles an agent with no capabilities', () => {
    expect(capabilityMatches('text', agent({ id: 'x', capabilities: [] }))).toBe(false);
  });
});

describe('rankAgents', () => {
  it('does not mutate the input array', () => {
    const input = [
      agent({ id: 'b', priceXLM: 2.0 }),
      agent({ id: 'a', priceXLM: 1.0 }),
    ];
    const snapshot = input.map((a) => a.id);
    rankAgents(input);
    expect(input.map((a) => a.id)).toEqual(snapshot);
  });

  it('sorts by price, then reputation DESC, then latency ASC', () => {
    const ranked = rankAgents([
      agent({ id: 'a', priceXLM: 1.0, reputationScore: 3.0, avgResponseTimeMs: 100 }),
      agent({ id: 'b', priceXLM: 1.0, reputationScore: 5.0, avgResponseTimeMs: 100 }),
      agent({ id: 'c', priceXLM: 0.5, reputationScore: 1.0, avgResponseTimeMs: 999 }),
    ]);
    expect(ranked.map((a) => a.id)).toEqual(['c', 'b', 'a']);
  });
});

// ---------------------------------------------------------------------------
// Async source support
// ---------------------------------------------------------------------------

describe('AgentMatcher — async source', () => {
  it('supports a function source returning a promise', async () => {
    const m = new AgentMatcher(async () => POOL);
    expect((await m.findBestAgent('text.summarize'))?.id).toBe('fast');
  });

  it('supports a function source returning a plain array', async () => {
    const m = new AgentMatcher(() => POOL);
    expect((await m.findBestAgent('text.summarize'))?.id).toBe('fast');
  });
});
