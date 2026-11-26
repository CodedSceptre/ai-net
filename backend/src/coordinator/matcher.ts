import type { AgentRegistration } from '../types/agent';
import type { AgentRecord } from '../db/agents';

export type AnyAgent =
  | AgentRegistration
  | AgentRecord
  | { id: string; status?: string; capabilities?: string[]; [key: string]: unknown };

/**
 * AgentMatcher selects eligible agents for task execution.
 * Agents with status of 'offline' or 'deregistered' are skipped and return null.
 */
export class AgentMatcher {
  /**
   * Matches an eligible agent for task execution.
   * Returns null if agent is offline or deregistered, or if no candidates qualify.
   */
  static match<T extends AnyAgent>(agents: T | T[], capability?: string): T | null {
    if (!agents) return null;
    const list = Array.isArray(agents) ? agents : [agents];
    const eligible = list.filter((agent) => {
      if (!agent) return false;
      const status = (agent.status as string) ?? 'online';
      if (status === 'offline' || status === 'deregistered') {
        return false;
      }
      if (capability) {
        const caps = (agent as any).capabilities ?? ((agent as any).type ? [(agent as any).type] : []);
        if (Array.isArray(caps) && caps.length > 0 && !caps.includes(capability)) {
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) return null;
    return eligible[0];
  }

  match<T extends AnyAgent>(agents: T | T[], capability?: string): T | null {
    return AgentMatcher.match(agents, capability);
  }

  matchAgent<T extends AnyAgent>(agent: T): T | null {
    return AgentMatcher.match(agent);
  }
}

export const agentMatcher = new AgentMatcher();
