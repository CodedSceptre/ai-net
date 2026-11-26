# Venice AI Prompting Guide

This guide is for developers building research, risk, coding, design, and report agents on ai-net. It covers model selection, prompt structure, context and cost budgets, batch and streaming requests, and failure handling.

## API and Model Selection

Venice provides an OpenAI-compatible chat completions endpoint:

```text
POST https://api.venice.ai/api/v1/chat/completions
Authorization: Bearer $VENICE_API_KEY
```

Use the model catalog to confirm IDs, availability, context limits, capabilities, and current rates before deploying. The table below reflects the public catalog queried on **2026-10-22**. Prices are USD per 1 million input/output tokens; the catalog is authoritative and rates can change.

| Model ID | Suggested use | Input / 1M tokens | Output / 1M tokens | Context tokens |
|---|---|---:|---:|---:|
| `qwen-3-8-flash` | Research triage, design briefs, report drafts | $0.14 | $0.49 | 1,000,000 |
| `z-ai-glm-5-3-flash` | Lower-cost risk analysis and structured extraction | $0.15 | $0.50 | 1,048,576 |
| `qwen3-coder-480b-a35b-instruct-turbo` | Code generation and review | $0.35 | $1.50 | 256,000 |
| `llama-3.3-70b` | General-purpose analysis and synthesis | $0.70 | $2.80 | 128,000 |
| `z-ai-glm-5-3` | Complex, high-consequence risk analysis | $1.75 | $5.50 | 1,000,000 |

These are starting points, not quality guarantees. Evaluate candidates with representative tasks, a fixed rubric, and a token budget before selecting a production model. ai-net's backend currently maps agent kinds to `venice-xl` and `venice-code`; those IDs were not present in the public catalog when this guide was checked. Verify or update that mapping against the live catalog before relying on it. The examples below use catalog IDs.

## Prompt Patterns

Keep system instructions stable and put task-specific data in the user message. State the audience, scope, evidence rules, output shape, and what the model should do when information is missing. Treat output as untrusted input: validate structured responses before using them.

The following templates cover the five ai-net agent types:

```typescript
type AgentKind = 'research' | 'risk' | 'coding' | 'design' | 'report';

const systemPrompts: Record<AgentKind, string> = {
  research: `You are a research analyst. Separate sourced facts from inference.
Return a concise summary, key findings, and sources with title and URL.
Do not invent citations; state when evidence is unavailable.`,
  risk: `You are a risk analyst. Identify concrete risks, their evidence,
likelihood and impact, mitigations, and unresolved assumptions. Do not present
an estimate as a verified fact. Return a structured, concise analysis.`,
  coding: `You are a senior software engineer. Use only the supplied repository
context and requirements. Propose the smallest correct change, explain edge
cases, and include focused verification steps. Never claim a command or test
was run unless it actually was.`,
  design: `You are a product designer. Respect the supplied users, platform,
accessibility requirements, and design constraints. Return a clear hierarchy,
interaction states, responsive behavior, and rationale; flag conflicts rather
than silently ignoring requirements.`,
  report: `You are a report editor. Synthesize only the supplied findings,
preserve attribution and uncertainty, remove repetition, and distinguish
conclusions from open questions. Return an executive summary followed by
evidence-based findings and sources.`,
};
```

For example, ask the research agent for a market comparison with a bounded date range and explicit source requirements. Ask the risk agent to assess a named threat model, not to declare a system “safe.” Give the coding agent the relevant files and acceptance criteria rather than an entire repository dump. Give the design agent viewport, accessibility, and component constraints. Ask the report agent to synthesize validated upstream results and retain their source IDs.

## TypeScript: Batch Requests

This minimal helper uses the native `fetch` API and the documented chat-completions response shape. Keep `VENICE_API_KEY` in the process environment or a secret manager; never put it in source control or client-side code.

```typescript
type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type ChatResponse = { choices?: Array<{ message?: { content?: string } }> };

async function complete(
  model: string,
  messages: Message[],
  maxTokens = 800,
): Promise<string> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error('VENICE_API_KEY is required');

  const response = await fetch('https://api.venice.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Venice returned HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as ChatResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Venice response has no message content');
  return content;
}

const result = await complete('qwen-3-8-flash', [
  { role: 'system', content: systemPrompts.research },
  { role: 'user', content: 'Compare the supplied market evidence for 2025. Cite only the supplied sources.' },
]);
console.log(result);
```

Use `max_tokens` to cap generated output. ai-net's backend defaults to 2,048 completion tokens and rejects requests above its 8,192-token hard cap; the task API also limits prompt characters. These are ai-net safeguards, not Venice-wide limits.

## Context and Token Budgets

- Reserve room for the system prompt, user request, retrieved context, and expected output within the selected model's context window.
- Tokenization varies by model. `Math.ceil(text.length / 4)` is only a rough early warning; use a tokenizer appropriate to the selected model for production budgets.
- For long inputs, split at semantic boundaries (documents, sections, or records), not arbitrary character offsets. Keep source IDs and metadata attached to every chunk.
- Summarize chunks into a fixed schema with source IDs, then synthesize those summaries. Retain access to the original passages for citation checks; summaries can omit important qualifiers.
- Limit retrieval to the most relevant, non-duplicated passages. Do not repeatedly resend the full conversation when a compact state summary will do.
- Set maximum input and output budgets per task type and stop or request clarification when the budget is insufficient.

### Estimating Cost

Use the provider's returned usage values where available. Before a request, estimate with:

```text
estimated USD = input tokens * input USD per 1M / 1,000,000
              + output tokens * output USD per 1M / 1,000,000
```

Example using `qwen-3-8-flash`: 12,000 input tokens and 1,500 output tokens at the listed rates estimate to `$0.002415` before any provider-specific adjustments. Retries and uncached calls add cost; caching can reduce repeated identical work, but do not assume a cache hit. Use measured usage and current rates for billing decisions.

## Streaming Responses

Streaming sends `stream: true` and returns server-sent event frames. The example below demonstrates the contract; production code should also handle cancellation, partial frames, and request timeouts.

```typescript
type StreamPayload = { choices?: Array<{ delta?: { content?: string } }> };

async function streamCompletion(
  model: string,
  messages: Message[],
  onToken: (token: string) => void,
): Promise<void> {
  const apiKey = process.env.VENICE_API_KEY;
  if (!apiKey) throw new Error('VENICE_API_KEY is required');

  const response = await fetch('https://api.venice.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, max_tokens: 800, stream: true }),
  });
  if (!response.ok) throw new Error(`Venice returned HTTP ${response.status}`);
  if (!response.body) throw new Error('Venice response has no stream body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    if (done) buffer += decoder.decode();

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        const payload = JSON.parse(line.slice(6)) as StreamPayload;
        const token = payload.choices?.[0]?.delta?.content;
        if (typeof token === 'string') onToken(token);
      }
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
}
```

Use streaming when partial text improves perceived latency, such as a user-facing draft. Use a batch response when the caller needs a complete result before validation, JSON parsing, or an on-chain action. Do not treat partial streamed output as a completed or validated result.

## Errors and Local Development

| Condition | Recommended handling |
|---|---|
| `401` or `403` | Stop retries; check key validity, permissions, and secret configuration. |
| `400` or `422` | Inspect the model ID and request schema; correct the request instead of retrying unchanged input. |
| `429` | Honor `Retry-After` when provided; otherwise use bounded exponential backoff with jitter and enforce a per-task retry budget. |
| `5xx`, timeout, or network failure | Retry a small bounded number of times, then fail gracefully or use a permitted cached result. Avoid retry storms. |
| Model unavailable | Check the live model catalog and select an explicitly supported alternative; do not silently change models for safety-sensitive tasks. |
| Refusal or filtered output | Surface a safe, actionable error. Do not retry by weakening policy or disguising the request. |
| Invalid structured output | Parse and validate against a schema. Allow at most a bounded repair attempt, and never trust unvalidated fields. |

For local development, set a development-only key through an ignored `.env` file, keep `max_tokens` small, and send a short representative prompt. Mock the HTTP boundary for deterministic unit checks; do not make CI depend on a paid live API. Record model ID, latency, status, retry count, and provider usage, but never log API keys or full sensitive prompts. ai-net's client already uses timeouts, bounded retries, provider failover, a circuit breaker, and optional cached fallback; direct API callers should implement equivalent controls appropriate to their application.

## JSON Output Mode

Venice AI supports structured JSON output via the `response_format` parameter. Set `response_format: { type: "json_object" }` in the request body to constrain the model to emit valid JSON.

### Request wrapper

```typescript
const response = await fetch('https://api.venice.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.1,
    response_format: { type: 'json_object' },
  }),
});
```

The system prompt must instruct the model to return JSON in a specific schema. Without an explicit schema instruction, models may produce arbitrary key names. Use this pattern:

```text
Return your response as a JSON object with exactly these keys:
{
  "summary": string,
  "findings": array of { "point": string, "confidence": number },
  "sources": array of { "title": string, "url": string },
  "confidence": number between 0.0 and 1.0
}
Do not include any text outside the JSON object.
```

### Retry strategy for malformed JSON

Models occasionally return malformed JSON despite the `response_format` constraint. Apply up to 3 retries with an explicit correction prompt:

```typescript
async function completeJson<T>(
  model: string,
  messages: Message[],
  schema: string,
  maxRetries = 3,
): Promise<T> {
  let lastContent = '';
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const content = await complete(model, messages, 1600);
    lastContent = content;
    try {
      return JSON.parse(content) as T;
    } catch {
      // Inject a correction prompt on the next attempt
      messages = [
        ...messages,
        { role: 'assistant', content },
        {
          role: 'user',
          content: `Your previous response was not valid JSON. Return only a JSON object matching this schema: ${schema}`,
        },
      ];
    }
  }
  throw new Error(`Failed to get valid JSON after ${maxRetries} attempts. Last response: ${lastContent.slice(0, 200)}`);
}
```

### TypeScript schema validation

Validate the parsed JSON against a TypeScript schema before using it. Use Zod for runtime validation:

```typescript
import { z } from 'zod';

const ResearchOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(z.object({ point: z.string(), confidence: z.number().min(0).max(1) })),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
  confidence: z.number().min(0).max(1),
});

type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

const raw = JSON.parse(content);
const result = ResearchOutputSchema.safeParse(raw);
if (!result.success) {
  throw new Error(`Schema validation failed: ${result.error.message}`);
}
// result.data is typed as ResearchOutput
```

Never use an unvalidated model response in downstream processing, on-chain actions, or reputation updates.

---

## Confidence Scoring

Every agent response includes a `confidence` field in the range `[0.0, 1.0]`. This score represents the agent's self-assessed certainty about its output given the available evidence.

### Scoring formula

The score is derived from three components weighted as follows:

| Component | Weight | Derivation |
|---|---|---|
| Evidence availability | 0.5 | Fraction of claims backed by cited sources |
| Scope coverage | 0.3 | Fraction of the user's stated requirements addressed |
| Consistency | 0.2 | Absence of self-contradictions in the output |

```text
confidence = 0.5 * (cited_claims / total_claims)
           + 0.3 * (addressed_requirements / total_requirements)
           + 0.2 * (1 - contradiction_flag)
```

The model computes this internally and embeds the result in the `confidence` field of the JSON output. The backend does not recompute it.

### Embedding in the response

Instruct the model to include the score explicitly:

```text
After producing your analysis, calculate a confidence score between 0.0 and 1.0
based on how much of your answer is supported by the supplied evidence.
Include it as the "confidence" field in your JSON output.
A score of 1.0 means every claim is sourced. A score of 0.0 means you are
guessing with no evidence.
```

### Downstream handling of low-confidence results

| Confidence range | Action |
|---|---|
| 0.8 – 1.0 | Accept result; pass to downstream agent or return to user |
| 0.5 – 0.79 | Flag for human review; include confidence in API response |
| 0.0 – 0.49 | Reject result; do not use in on-chain actions; return error to caller |

Low-confidence results reduce reputation impact: a task completed with confidence < 0.5 contributes 50% of the normal positive reputation delta to the agent's score. This prevents agents from farming reputation through low-quality outputs.

---

## Prompt Versioning

### File naming convention

Prompts are stored in `backend/src/prompts/` with the following naming scheme:

```
{agent_kind}_v{major}.{minor}.ts
```

Examples:
- `research_v1.0.ts` — initial production prompt
- `research_v1.1.ts` — backward-compatible change (output format unchanged)
- `research_v2.0.ts` — breaking change (output format changed)

Each file exports a `PromptVersion` object:

```typescript
export interface PromptVersion {
  version: string;          // semver: "1.2.0"
  agentKind: AgentKind;
  systemPrompt: string;
  outputSchema: string;     // JSON schema string for the expected output
  changeLog: string;        // human-readable summary of what changed
  breakingChange: boolean;  // true if output format changed
}

export const researchPromptV1: PromptVersion = {
  version: '1.0.0',
  agentKind: 'research',
  systemPrompt: systemPrompts.research,
  outputSchema: JSON.stringify(ResearchOutputSchema.shape),
  changeLog: 'Initial production prompt',
  breakingChange: false,
};
```

### When to bump the version

| Change type | Version increment |
|---|---|
| Rephrasing that doesn't change output structure | Patch (`1.0.0` → `1.0.1`) |
| New field added to JSON output | Minor (`1.0.0` → `1.1.0`) |
| Field removed or renamed; output format changed | Major (`1.0.0` → `2.0.0`) |

A major bump requires updating all consumers that parse the output and updating the Zod schema.

### A/B testing a new prompt version

1. Deploy the new prompt version alongside the current version without replacing it.
2. Route a configurable percentage of requests (e.g. 10%) to the new version using a feature flag.
3. Compare on three metrics over at least 500 requests:
   - **Schema compliance rate**: fraction of responses that pass Zod validation without retries
   - **Mean confidence score**: higher is better assuming calibration is consistent
   - **P95 latency**: the new version must not regress latency by more than 15%
4. If the new version wins on all three metrics, promote it to 100% and archive the old version file.

### Rollback procedure

1. Update the active version reference in `backend/src/prompts/index.ts` to the previous version constant.
2. Deploy. No database migration or on-chain action is required.
3. If the bad version produced stored outputs that downstream systems consumed, audit those records manually.

---

## Hallucination Mitigation

Production prompts apply the following techniques. Each entry shows the exact instruction text added to the system prompt.

**1. Chain-of-thought forcing**

```text
Before writing your final answer, reason step by step through the evidence.
Label this section "Reasoning:" and do not include it in the JSON output.
```

**2. Explicit uncertainty acknowledgment**

```text
If you are uncertain about a claim, write "I am not certain:" before the claim
and reduce the confidence score accordingly. Do not present uncertain claims
as facts.
```

**3. Source citation requirement (research agents only)**

```text
Every factual claim must include a source reference in the format [SOURCE: title, url].
If you cannot cite a source for a claim, omit the claim.
Do not invent citations. If a URL is unavailable, write [SOURCE: title, unavailable].
```

**4. Refusal instruction for out-of-scope requests**

```text
If the user's request falls outside the supplied context or your defined role,
respond with: { "error": "out_of_scope", "message": "<reason>" }
Do not attempt to answer questions you cannot ground in the supplied evidence.
```

**5. Closed-world assumption**

```text
Treat the supplied documents as the complete evidence base.
Do not introduce information from your training data that is not present in the
supplied context. If the supplied context is insufficient, say so explicitly.
```

**6. Anti-hallucination reminder for coding agents**

```text
Never claim a command was run, a test passed, or a file was created unless it
actually happened in this conversation. If you are proposing code, say "proposed"
or "untested". Do not assert correctness.
```

**7. Structured output discipline**

```text
Return only the JSON object. Do not include explanatory prose, markdown fences,
or comments outside the JSON. The response must be parseable by JSON.parse()
with no preprocessing.
```

---

## Few-Shot Examples

Few-shot examples are added to the user message, not the system prompt, to keep the system prompt stable across requests. Each agent type has a fixed set of examples stored alongside the prompt version file.

### Format

```typescript
interface FewShotExample {
  input: string;
  output: string;  // must match the agent's JSON output schema
}

function buildUserMessageWithExamples(
  examples: FewShotExample[],
  actualInput: string,
): string {
  const exampleBlock = examples
    .map((ex, i) => `Example ${i + 1}:\nInput: ${ex.input}\nOutput: ${ex.output}`)
    .join('\n\n');
  return `${exampleBlock}\n\nNow process this input:\n${actualInput}`;
}
```

### Count per agent type

| Agent kind | Examples | Rationale |
|---|---|---|
| research | 2 | Long outputs; more examples exceed budget |
| risk | 2 | Same constraint; risk analysis is verbose |
| coding | 1 | Code examples are expensive in tokens |
| design | 2 | Medium length; 2 covers mobile and desktop |
| report | 1 | Synthesis outputs are long |

### Updating examples

When an agent's output quality degrades, add a new example that demonstrates the correct behavior. Remove examples that are redundant or outdated. Each update constitutes a minor version bump to the prompt version. Never add examples that contain real user data or sensitive project information.

---

## Testing Prompt Changes

Use the test harness documented in [AI Agent Integration Guide](ai-agent-integration-guide.md) to evaluate a modified prompt before deploying it.

### Procedure

1. Create a test dataset of 20–50 representative inputs for the agent type, covering normal cases, edge cases, and known failure modes.
2. Run both the current prompt version and the candidate version against the full dataset using the test harness.
3. For each run, record:
   - **Schema compliance rate**: `passed_zod_validation / total_requests`
   - **Confidence score distribution**: mean, P10, P90
   - **Latency**: mean and P95 in milliseconds
   - **Retry rate**: fraction of requests that required a JSON correction retry
4. A candidate prompt passes if:
   - Schema compliance ≥ 98%
   - Mean confidence ≥ current version mean (within 0.05 tolerance)
   - P95 latency ≤ current version P95 × 1.15
   - Retry rate ≤ current version retry rate × 1.25
5. Record test results in the prompt version's `changeLog` field before merging.

### Mocking for CI

Do not make live API calls in CI. Use the recorded response fixtures in `backend/tests/fixtures/veniceResponses.ts` as the mock layer. Add new fixtures for each new agent capability or output schema change tested.

---

## References

- [Venice API model catalog](https://api.venice.ai/api/v1/models) — model IDs, context limits, capabilities, and price metadata.
- [Venice model-list API reference](https://docs.venice.ai/api-reference/endpoint/models/list)
- [Venice chat-completions API reference](https://docs.venice.ai/api-reference/endpoint/chat/completions)
- [ai-net Venice client](../backend/src/services/venice/client.ts) — internal agent mapping, retries, streaming, and token limits.
- [AI-Agent Integration Guide](ai-agent-integration-guide.md)