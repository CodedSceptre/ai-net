import { budgetOverage, CostEstimator } from "./costEstimator";
import type { AgentRegistration } from "../types/agent";
import type { DAGNode } from "../types/task";

function nodes(...capabilities: string[]): DAGNode[] {
  return capabilities.map((type, index) => ({
    nodeId: `node-${index}`,
    type,
    dependencies: index ? [`node-${index - 1}`] : [],
    status: "pending",
  }));
}

function agent(type: string, cost: number, status: AgentRegistration["status"] = "online") {
  return { id: `${type}-${cost}`, type, cost, status, endpoint: "https://agent.example.org" };
}

function registry(...agents: AgentRegistration[]) {
  return { getAgents: jest.fn((type?: string) => agents.filter((entry) => entry.type === type)) };
}

const estimator = new CostEstimator();

it("quotes five nodes using the cheapest online agent per capability", async () => {
  const capabilities = ["research", "risk", "design", "coding", "report"];
  const cheapest = capabilities.map((type, index) => agent(type, (index + 1) / 10));
  const result = await estimator.estimate(nodes(...capabilities), registry(
    ...cheapest, agent("coding", 0.01, "offline"), agent("coding", 4),
  ));
  expect(result).toMatchObject({ totalXLM: 1.65, subtotalXLM: 1.5, bufferXLM: 0.15 });
  expect(result.breakdown?.map(({ agentId }) => agentId)).toEqual(cheapest.map(({ id }) => id));
});

it("returns only the first missing capability", async () => {
  await expect(estimator.estimate(nodes("research", "coding"), registry(agent("research", 1))))
    .resolves.toEqual({ error: "NO_AGENT_AVAILABLE", nodeType: "coding" });
});

it("reports the budget overage for a single-node quote", async () => {
  const result = await estimator.estimate(nodes("research"), registry(agent("research", 0.3)));
  if ("error" in result) throw new Error("Expected an estimate");
  expect(result).toMatchObject({ totalXLM: 0.33, subtotalXLM: 0.3, bufferXLM: 0.03 });
  expect(budgetOverage(result.totalXLM, 0.2)).toEqual({ budgetExceeded: true, overageXLM: 0.13 });
  expect(budgetOverage(result.totalXLM, 0.33)).toEqual({});
});

it("charges each node when all nodes use the same agent", async () => {
  const store = registry(agent("coding", 0.6));
  const result = await estimator.estimate(nodes("coding", "coding", "coding"), store);
  expect(result).toMatchObject({ totalXLM: 1.98, subtotalXLM: 1.8, bufferXLM: 0.18 });
  expect(result.breakdown).toHaveLength(3);
  expect(store.getAgents).toHaveBeenCalledTimes(1);
});
