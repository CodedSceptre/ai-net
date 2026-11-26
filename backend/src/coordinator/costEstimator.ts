import type { AgentRegistration, AgentRegistry } from "../types/agent";
import type { DAGNode } from "../types/task";

export class CostEstimator {
  async findCheapest(capability: string, registry: AgentRegistry): Promise<AgentRegistration | undefined> {
    const agents = await registry.getAgents(capability);
    let cheapest: AgentRegistration | undefined;
    for (const agent of agents) {
      if (agent.type === capability && agent.status === "online" && Number.isFinite(agent.cost) &&
          agent.cost >= 0 && (!cheapest || agent.cost < cheapest.cost)) {
        cheapest = agent;
      }
    }
    return cheapest;
  }

  async estimate(dag: readonly DAGNode[], registry: AgentRegistry) {
    const breakdown = [];
    let subtotalStroops = 0;
    const selected = new Map<string, AgentRegistration>();
    for (const node of dag) {
      const agent = selected.get(node.type) ?? await this.findCheapest(node.type, registry);
      if (!agent) return { error: "NO_AGENT_AVAILABLE" as const, nodeType: node.type };

      selected.set(node.type, agent);
      subtotalStroops += Math.round(agent.cost * 10_000_000);
      breakdown.push({
        nodeId: node.nodeId,
        agentId: agent.id,
        agentName: agent.name ?? agent.id,
        priceXLM: agent.cost,
      });
    }

    const bufferStroops = Math.ceil(subtotalStroops / 10);
    return {
      subtotalXLM: subtotalStroops / 10_000_000,
      bufferXLM: bufferStroops / 10_000_000,
      totalXLM: (subtotalStroops + bufferStroops) / 10_000_000,
      breakdown,
    };
  }
}

export function budgetOverage(totalXLM: number, maxBudgetXLM?: number) {
  return maxBudgetXLM !== undefined && totalXLM > maxBudgetXLM
    ? { budgetExceeded: true, overageXLM: Number((totalXLM - maxBudgetXLM).toFixed(7)) }
    : {};
}
