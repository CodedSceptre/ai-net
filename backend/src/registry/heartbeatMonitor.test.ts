import { EventEmitter } from 'events';
import express from 'express';
import request from 'supertest';
import { HeartbeatMonitor } from './heartbeatMonitor';
import { AgentMatcher } from '../coordinator/matcher';
import { createAgentsRouter } from '../api/routes/agents';
import type { AgentRecord, AgentDb } from '../db/agents';

describe('HeartbeatMonitor & Agent Liveness (#666)', () => {
  let mockAgents: Map<string, AgentRecord>;
  let mockDb: AgentDb;
  let mockEventBus: EventEmitter;
  let revokeOnChainSpy: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-26T12:00:00.000Z') });

    mockAgents = new Map<string, AgentRecord>();

    mockDb = {
      upsert: jest.fn((agent: AgentRecord) => {
        mockAgents.set(agent.id, { ...agent });
      }),
      findById: jest.fn((id: string) => {
        return mockAgents.get(id);
      }),
      list: jest.fn(() => {
        return Array.from(mockAgents.values());
      }),
      delete: jest.fn((id: string) => {
        mockAgents.delete(id);
      }),
      updateReputation: jest.fn(),
      updateReputationWithStats: jest.fn(),
      countByStellarKey: jest.fn().mockReturnValue(0),
      markAllOffline: jest.fn(),
      updateLastSeen: jest.fn((id: string) => {
        const existing = mockAgents.get(id);
        if (existing) {
          existing.lastSeenAt = new Date().toISOString();
          existing.status = 'online';
          mockAgents.set(id, existing);
        }
      }),
      listBannedAgentIds: jest.fn().mockReturnValue([]),
      markStaleAgents: jest.fn().mockReturnValue(0),
      deleteOfflineAgents: jest.fn().mockReturnValue(0),
    } as unknown as AgentDb;

    mockEventBus = new EventEmitter();
    revokeOnChainSpy = jest.fn();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Liveness Lifecycle & Auto-Deregistration with Fake Timers', () => {
    it('marks an agent offline after 15 minutes without heartbeats and emits agent_offline', async () => {
      const monitor = new HeartbeatMonitor({
        db: mockDb,
        eventBus: mockEventBus,
        revokeOnChain: revokeOnChainSpy,
        intervalMs: 60_000,
        offlineThresholdMs: 15 * 60 * 1000,
        deregisterThresholdMs: 45 * 60 * 1000,
        now: () => Date.now(),
      });

      mockAgents.set('agent_1', {
        id: 'agent_1',
        capabilities: ['research'],
        pricingXLM: 1,
        endpoint: 'http://localhost:8001',
        stellarPublicKey: 'GAAAA111111111111111111111111111111111111111111111111111',
        reputationScore: 4.5,
        lastSeenAt: new Date().toISOString(),
        status: 'online',
      });

      const offlineEvents: any[] = [];
      mockEventBus.on('agent_offline', payload => offlineEvents.push(payload));

      monitor.start();

      // Advance by 14 minutes (under 15 min threshold) -> agent remains online
      jest.advanceTimersByTime(14 * 60 * 1000);
      await Promise.resolve();

      expect(mockAgents.get('agent_1')?.status).toBe('online');
      expect(offlineEvents).toHaveLength(0);

      // Advance by another 2 minutes (16 minutes total) -> agent transitions to offline
      jest.advanceTimersByTime(2 * 60 * 1000);
      await Promise.resolve();

      expect(mockAgents.get('agent_1')?.status).toBe('offline');
      expect(offlineEvents).toHaveLength(1);
      expect(offlineEvents[0]).toEqual({ agentId: 'agent_1', reason: 'heartbeat_timeout' });

      monitor.stop();
    });

    it('marks an agent deregistered after 45 minutes total without heartbeats, calls revocation exactly once, and emits agent_deregistered', async () => {
      const monitor = new HeartbeatMonitor({
        db: mockDb,
        eventBus: mockEventBus,
        revokeOnChain: revokeOnChainSpy,
        intervalMs: 60_000,
        offlineThresholdMs: 15 * 60 * 1000,
        deregisterThresholdMs: 45 * 60 * 1000,
        now: () => Date.now(),
      });

      mockAgents.set('agent_1', {
        id: 'agent_1',
        capabilities: ['research'],
        pricingXLM: 1,
        endpoint: 'http://localhost:8001',
        stellarPublicKey: 'GAAAA111111111111111111111111111111111111111111111111111',
        reputationScore: 4.5,
        lastSeenAt: new Date().toISOString(),
        status: 'online',
      });

      const deregisterEvents: any[] = [];
      mockEventBus.on('agent_deregistered', payload => deregisterEvents.push(payload));

      monitor.start();

      // Advance 15 min -> goes offline
      jest.advanceTimersByTime(15 * 60 * 1000);
      await Promise.resolve();
      expect(mockAgents.get('agent_1')?.status).toBe('offline');
      expect(revokeOnChainSpy).not.toHaveBeenCalled();

      // Advance to 45 min total (30 min more) -> goes deregistered
      jest.advanceTimersByTime(30 * 60 * 1000);
      await Promise.resolve();

      expect(mockAgents.get('agent_1')?.status).toBe('deregistered');
      expect(deregisterEvents).toHaveLength(1);
      expect(deregisterEvents[0]).toEqual({ agentId: 'agent_1', reason: 'heartbeat_timeout' });
      expect(revokeOnChainSpy).toHaveBeenCalledTimes(1);
      expect(revokeOnChainSpy).toHaveBeenCalledWith('agent_1');

      // Advance another 30 minutes -> revocation is not called again (called exactly once)
      jest.advanceTimersByTime(30 * 60 * 1000);
      await Promise.resolve();

      expect(revokeOnChainSpy).toHaveBeenCalledTimes(1);

      monitor.stop();
    });

    it('HeartbeatMonitor.stop() clears the interval and prevents further checks', async () => {
      const monitor = new HeartbeatMonitor({
        db: mockDb,
        eventBus: mockEventBus,
        revokeOnChain: revokeOnChainSpy,
        intervalMs: 60_000,
        now: () => Date.now(),
      });

      mockAgents.set('agent_1', {
        id: 'agent_1',
        capabilities: ['research'],
        pricingXLM: 1,
        endpoint: 'http://localhost:8001',
        stellarPublicKey: 'GAAAA111111111111111111111111111111111111111111111111111',
        reputationScore: 4.5,
        lastSeenAt: new Date().toISOString(),
        status: 'online',
      });

      monitor.start();
      monitor.stop();

      // Advance by 60 minutes
      jest.advanceTimersByTime(60 * 60 * 1000);
      await Promise.resolve();

      // Status should remain unchanged because monitor was stopped
      expect(mockAgents.get('agent_1')?.status).toBe('online');
      expect(revokeOnChainSpy).not.toHaveBeenCalled();
    });
  });

  describe('AgentMatcher Integration', () => {
    it('returns the agent when status is online', () => {
      const agent = {
        id: 'agent_online',
        capabilities: ['coding'],
        status: 'online' as const,
      };

      const match = AgentMatcher.match([agent], 'coding');
      expect(match).not.toBeNull();
      expect(match?.id).toBe('agent_online');
    });

    it('returns null (no match) for agents with status offline or deregistered', () => {
      const offlineAgent = {
        id: 'agent_offline',
        capabilities: ['coding'],
        status: 'offline' as const,
      };
      const deregisteredAgent = {
        id: 'agent_deregistered',
        capabilities: ['coding'],
        status: 'deregistered' as const,
      };

      expect(AgentMatcher.match(offlineAgent)).toBeNull();
      expect(AgentMatcher.match(deregisteredAgent)).toBeNull();
      expect(AgentMatcher.match([offlineAgent, deregisteredAgent], 'coding')).toBeNull();
    });
  });

  describe('POST /api/agents/:id/heartbeat Endpoint', () => {
    it('updates lastSeenAt and sets status to online, returning expected payload', async () => {
      const initialDate = '2026-11-26T10:00:00.000Z';
      mockAgents.set('agent_test', {
        id: 'agent_test',
        capabilities: ['research'],
        pricingXLM: 1,
        endpoint: 'http://localhost:8001',
        stellarPublicKey: 'test-wallet',
        reputationScore: 3.5,
        lastSeenAt: initialDate,
        status: 'offline',
      });

      const app = express();
      app.use(express.json());
      app.use('/api/agents', createAgentsRouter({ db: mockDb }));

      const res = await request(app)
        .post('/api/agents/agent_test/heartbeat')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.agentId).toBe('agent_test');
      expect(res.body.lastSeenAt).toBeDefined();
      expect(res.body.nextExpectedAt).toBeDefined();

      const stored = mockAgents.get('agent_test');
      expect(stored?.status).toBe('online');
      expect(stored?.lastSeenAt).not.toBe(initialDate);
    });
  });
});
