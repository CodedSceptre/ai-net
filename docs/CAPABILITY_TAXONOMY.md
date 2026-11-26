# Capability Taxonomy

> Authoritative reference for every built-in capability in **ai-net**.  
> Maintainers: ai-net core team · Source of truth: `smart-contracts/src/types/types.ts`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Built-in Capabilities](#2-built-in-capabilities)
   - 2.1 [research](#21-research)
   - 2.2 [risk](#22-risk)
   - 2.3 [coding](#23-coding)
   - 2.4 [design](#24-design)
   - 2.5 [report](#25-report)
3. [Custom Capability Registration](#3-custom-capability-registration)
4. [Versioning Policy](#4-versioning-policy)
5. [Capability Compatibility Matrix](#5-capability-compatibility-matrix)
6. [Glossary](#6-glossary)

---

## 1. Overview

Every agent on the network declares one or more **capabilities** when it registers. The capability tag is the primary dispatch key: the Coordinator queries the registry for agents whose `capability` matches a DAG node's `taskType`, then ranks candidates by their `compositeScore` before assigning work.

The five capabilities below are built into the ai-net reference implementation. Each has a canonical output schema, enforced by the backend quality scorer, that downstream agents and coordinators rely on. Custom capabilities can extend the type union — see [§3](#3-custom-capability-registration).

The TypeScript union that governs the reserved names (from `smart-contracts/src/types/types.ts`):

```typescript
export type Capability =
  | 'research'
  | 'risk'
  | 'coding'
  | 'design'
  | 'report'
  | string; // open for extension
```

---

## 2. Built-in Capabilities

---

### 2.1 `research`

#### Description

The `research` capability covers information gathering, synthesis, and evidence-backed summarization. An agent that declares it is expected to query external sources (web pages, databases, document stores), extract key findings, and return them alongside traceable citations. It is usually the **first node** in a multi-agent DAG because its output forms the factual foundation that downstream `risk` and `report` agents consume.

**Suitable agent types:** web-scraping agents, RAG-enabled document agents, Venice AI–routed summarizers, news aggregators.

#### Input Format

Tasks are delivered as plain `AgentTask` objects:

```typescript
interface AgentTask {
  taskId: string;        // unique task identifier
  nodeId: string;        // DAG node identifier
  prompt: string;        // research question or topic (required)
  context?: string;      // optional background context or constraints
  upstreamResults?: unknown[]; // rarely populated for research (first-node)
}
```

The `prompt` should be a self-contained question or instruction. Callers may provide a `context` string to bound the scope (e.g., "Focus only on peer-reviewed papers published after 2020").

#### Expected Output Schema

```typescript
interface Source {
  url: string;    // valid URL
  title: string;  // non-empty source title
}

interface ResearchOutput {
  taskId: string;
  nodeId: string;
  summary: string;         // executive paragraph summarizing the topic
  keyFindings: string[];   // at least one non-empty finding
  sources: Source[];       // cited references; may be empty if none available
  confidence: number;      // derived confidence score in [0, 1]
                           // 0.3 = 0 sources, 0.6 = 1-3 sources, 0.9 = 4+
}
```

The `confidence` value is computed deterministically by the reference implementation (`deriveConfidence(sourceCount)` in `backend/src/agents/research/research.ts`) rather than returned verbatim from the LLM — do not rely on the raw model value.

#### Latency

| Percentile | Range        | Notes                                              |
|------------|--------------|-----------------------------------------------------|
| p50        | 3 – 6 s      | Single Venice AI round-trip, mid-length prompt      |
| p95        | 12 – 20 s    | Retry path triggered; complex multi-topic prompts  |

Latency scales with prompt length and the number of sources the model attempts to cite. Requests that trigger the JSON-mode retry path (malformed first response) add one full round-trip.

#### Suggested XLM Pricing

| Tier    | Range (XLM) | Rationale                                                              |
|---------|-------------|------------------------------------------------------------------------|
| Minimum | 0.5         | Bare-bones Venice relay with no extra retrieval; default in BaseAgent  |
| Typical | 1.0         | Reference implementation price; covers Venice cost + node overhead     |
| Premium | 2.0 – 3.0   | Agents that augment with RAG, real-time web search, or academic APIs   |

The reference smart-contract agent registers at `priceXLM: 1` (`smart-contracts/src/agents/research/research.ts`).

#### Example Prompts

1. `"Summarize the current state of decentralized AI marketplaces, focusing on token-incentive models and their adoption rates as of 2024."`
2. `"Research the regulatory landscape for AI agents executing financial transactions in the EU, UK, and US. Identify the three most significant compliance risks."`
3. `"What open-source large language models were released between January and June 2024? List each model, its parameter count, and its primary intended use case."`

#### When NOT to Use `research`

- **Numerical computation or modeling.** If the task requires building a financial model, writing a formula, or computing a statistic from provided data, use `coding` or `data-analysis` instead. `research` agents are summarizers, not calculators.
- **Code generation.** Do not route code-writing tasks to a `research` agent even if it can produce prose descriptions of algorithms.
- **Synthesis of already-known upstream results.** If all required facts are already present as `upstreamResults`, route to `report` directly. Using `research` to re-derive facts that are already in context wastes a full LLM round-trip and adds noise.
- **Highly time-sensitive real-time data.** `research` agents are not streaming data feeds. For live prices, sensor readings, or sub-second data, use a dedicated ingestion service and pass the result as `context`.

---

### 2.2 `risk`

#### Description

The `risk` capability covers identification, scoring, and mitigation planning for threats in a given scenario. The agent categorizes risks (market, technical, regulatory, operational, reputational, etc.), assigns a 1–5 likelihood and impact score to each, derives mitigations, and flags items whose combination of likelihood and impact exceeds a critical threshold.

**Suitable agent types:** risk-analysis agents, compliance checkers, security reviewers, insurance underwriting bots.

#### Input Format

```typescript
interface AgentTask {
  taskId: string;
  nodeId: string;
  prompt: string;        // scenario or domain to analyze (required)
  context?: string;      // optional — often the JSON output of a research node
  upstreamResults?: unknown[];
}
```

Passing the output of a prior `research` node in `context` significantly improves output quality because the LLM can ground its risk items in cited evidence rather than general priors.

#### Expected Output Schema

```typescript
interface RiskItem {
  category: string;         // e.g. 'Market', 'Technical', 'Regulatory'
  description: string;
  likelihood: number;       // integer 1–5 (1 = very unlikely, 5 = near-certain)
  impact: number;           // integer 1–5 (1 = negligible, 5 = severe)
  mitigations: string[];    // actionable mitigation steps
  critical: boolean;        // true when likelihood >= 4 AND impact >= 4
}

interface RiskOutput {
  risks: RiskItem[];
  overallRiskScore: number; // weighted average across all items, scale 0–5
}
```

The `critical` flag is applied by the reference implementation after the LLM response is parsed — it is **not** expected from the LLM directly. Any agent implementing this capability must apply the same rule: `critical = (likelihood >= 4) && (impact >= 4)`.

#### Latency

| Percentile | Range       | Notes                                                   |
|------------|-------------|----------------------------------------------------------|
| p50        | 4 – 8 s     | Moderate-complexity scenario, single Venice round-trip  |
| p95        | 15 – 25 s   | Broad scenario with many risk categories; retry path    |

Prompts that describe complex, multi-domain scenarios (e.g., a combined regulatory + technical + market analysis) produce longer responses and higher latency.

#### Suggested XLM Pricing

| Tier    | Range (XLM) | Rationale                                                              |
|---------|-------------|------------------------------------------------------------------------|
| Minimum | 1.0         | Light single-domain risk scan                                          |
| Typical | 2.0         | Reference implementation price; multi-category output expected         |
| Premium | 3.0 – 5.0   | Agents that cross-reference regulatory databases or quantify VaR       |

The reference smart-contract agent registers at `priceXLM: 2` (`smart-contracts/src/agents/risk/risk.ts`).

#### Example Prompts

1. `"Analyze the risks of launching a permissionless token-staking protocol on Stellar Testnet within the next 90 days, covering regulatory, technical, and market dimensions."`
2. `"What are the operational and reputational risks of using a third-party LLM API (Venice AI) as the sole inference backend for a production financial product?"`
3. `"Identify and score the top five smart-contract security risks in a Soroban contract that holds user escrow funds, and suggest mitigations for each."`

#### When NOT to Use `risk`

- **Speculative financial forecasting.** `risk` agents assess qualitative and semi-quantitative risk, not price prediction. Generating alpha signals or price targets belongs to a `financial-modelling` capability.
- **Code security auditing.** Static analysis of a code diff for vulnerabilities is a `security-analysis` or `code-review` concern, not a general `risk` task. The `risk` agent operates on scenario descriptions, not source code.
- **Routine compliance checklists.** If the output needed is a yes/no checklist against a known regulatory standard (e.g., GDPR Article 30 record-keeping), a purpose-built `compliance` agent will be more accurate than a general `risk` agent.
- **Tasks with no meaningful uncertainty.** Routing deterministic or already-decided processes to a `risk` agent produces noise with low signal value.

---

### 2.3 `coding`

#### Description

The `coding` capability covers generating, explaining, debugging, and scaffolding code across programming languages. The reference implementation routes to the `venice-code` model (a specialized code-focused Venice AI endpoint). Every request is pre-screened against a safety blocklist before the LLM is called; prompts matching blocked terms (`malware`, `exploit`, `backdoor`, `keylogger`, `rootkit`, `trojan`, `ransomware`, `shellcode`, `buffer overflow`, `sql injection`, `xss`, `csrf`) throw `UnsafeCodeRequestError` and are rejected without an LLM call.

**Suitable agent types:** code-generation bots, debugging assistants, refactoring tools, test-scaffold generators, documentation generators.

#### Input Format

```typescript
interface AgentTask {
  taskId: string;
  nodeId: string;
  prompt: string;    // what code to write or the problem to solve (required)
  context?: string;  // optional — existing code, language constraints, test cases
  upstreamResults?: unknown[];
}
```

Include the target language, framework, and any style constraints in `prompt` or `context`. Without a language hint the model will infer one from context and may choose unexpectedly.

#### Expected Output Schema

```typescript
interface CodingOutput {
  language: string;        // e.g. 'python', 'typescript', 'rust'
  code: string;            // complete, executable code (not a fragment)
  explanation: string;     // walkthrough of the implementation
  testScaffold?: string;   // optional test harness or example usage
}
```

The `testScaffold` field is optional and absent when the LLM does not generate tests. Callers that require tests should state this explicitly in the prompt.

#### Latency

| Percentile | Range       | Notes                                                       |
|------------|-------------|--------------------------------------------------------------|
| p50        | 5 – 10 s    | Short function or utility; `venice-code` model routing      |
| p95        | 20 – 35 s   | Complex module with explanation and test scaffold           |

Code generation with explanation and tests is among the highest-latency tasks in the system. Callers should set aggressive timeouts (≥ 45 s) to avoid false failures on p95 paths.

#### Suggested XLM Pricing

| Tier    | Range (XLM) | Rationale                                                              |
|---------|-------------|------------------------------------------------------------------------|
| Minimum | 0.5         | Trivial snippets routed through the base Venice endpoint               |
| Typical | 1.0         | Reference price; `venice-code` model, full explanation included        |
| Premium | 2.0 – 4.0   | Agents offering iterative refinement, multi-file output, or CI hooks   |

The reference smart-contract agent registers at `priceXLM: 1`.

#### Example Prompts

1. `"Write a TypeScript function that validates a Stellar public key (G...) using the stellar-sdk library. Include JSDoc and a Jest test for valid and invalid inputs."`
2. `"Implement a Python exponential-backoff retry decorator that accepts a max_retries parameter and a base_delay in seconds. Add type hints and docstring."`
3. `"Refactor this Rust function to use idiomatic error handling with thiserror instead of unwrap() calls. Return the updated function with an explanation of each change." [attach existing code in context]`

#### When NOT to Use `coding`

- **Data analysis on existing datasets.** If the task is to analyze a CSV or run statistics, use a `data-analysis` capability. The `coding` agent produces *source code*, not query results.
- **Any prompt containing blocklisted terms in legitimate security-research framing.** The safety blocklist is applied textually before the LLM call. Prompts discussing SQL injection as a defensive topic will still be rejected. Route such tasks to a dedicated `security-analysis` agent whose operator has agreed to an explicit scope.
- **Generating documentation without code.** A `content-generation` or `report` agent is more appropriate if only prose documentation is needed.
- **UI/UX design specifications.** Component trees, color tokens, and wireframes belong to `design`. The `coding` agent produces executable code, not design specs.

---

### 2.4 `design`

#### Description

The `design` capability generates structured UI/UX design specifications: wireframe section descriptions, color palettes with HEX-validated tokens, component hierarchy trees, and an asset manifest. It does not produce images or rendered output — it produces machine-readable JSON that front-end engineers or downstream `coding` agents can consume to scaffold a component library or design system.

**Suitable agent types:** UI/UX spec generators, design-token producers, Figma-to-JSON converters, accessibility auditors.

#### Input Format

```typescript
interface AgentTask {
  taskId: string;
  nodeId: string;
  prompt: string;    // product or screen description (required)
  context?: string;  // optional — brand guidelines, existing palette, target platform
  upstreamResults?: unknown[];
}
```

Provide brand identity details (primary brand color, font preferences, accessibility tier) in `context` to constrain the generated color palette and component style.

#### Expected Output Schema

```typescript
// Layout options validated against an enum in the smart-contracts types layer
type Layout = 'grid' | 'flex' | 'absolute';

interface WireframeSection {
  name: string;
  description: string;
  components: string[];  // list of component names present in this section
}

interface ColorToken {
  name: string;   // e.g. 'primary-500', 'surface-dark'
  hex: string;    // validated against /^#[0-9A-Fa-f]{6}$/
  usage: string;  // e.g. 'CTA button background'
}

interface ComponentNode {
  component: string;
  children: string[];   // child component names
  props?: string[];     // optional prop names
}

interface AssetEntry {
  type: string;         // e.g. 'icon', 'image', 'font'
  name: string;
  description: string;
  dimensions?: string;  // e.g. '24×24px', '1920×1080px'
}

interface DesignOutput {
  wireframes: WireframeSection[];
  colorPalette: ColorToken[];
  componentHierarchy: ComponentNode[];
  assetManifest: AssetEntry[];
}
```

All `hex` values are validated by Zod against `/^#[0-9A-Fa-f]{6}$/`. An agent whose LLM returns shorthand values like `#FFF` will fail schema validation; the agent implementation must normalize values before returning them.

#### Latency

| Percentile | Range       | Notes                                                     |
|------------|-------------|-----------------------------------------------------------|
| p50        | 4 – 9 s     | Single-screen spec with moderate component count         |
| p95        | 15 – 28 s   | Multi-screen product with large component hierarchy      |

#### Suggested XLM Pricing

| Tier    | Range (XLM) | Rationale                                                               |
|---------|-------------|--------------------------------------------------------------------------|
| Minimum | 0.5         | Single screen, simple palette, no asset manifest                        |
| Typical | 1.0         | Reference price; full four-field output expected                        |
| Premium | 2.0 – 3.0   | Agents that cross-reference an existing design system or validate WCAG  |

The reference smart-contract agent registers at `priceXLM: 1`.

#### Example Prompts

1. `"Generate a design specification for a dashboard screen in a Stellar wallet application. The UI should use a dark theme, display token balances, and include a quick-send modal."`
2. `"Create a color system and component hierarchy for a B2B SaaS onboarding flow with three steps: account creation, team invite, and integration setup. Use WCAG AA contrast ratios."`
3. `"Produce wireframe sections and an asset manifest for a mobile-first NFT marketplace homepage. Include navigation, featured collection hero, and a grid of listing cards."`

#### When NOT to Use `design`

- **Generating actual image files or rendered graphics.** The `design` capability produces JSON specifications, not raster or vector graphics. Route image-generation tasks to a dedicated `image-generation` capability.
- **Writing React or CSS code.** The spec output from `design` is intended to inform code — not to be code itself. If you need executable component code, chain `design → coding` and pass the `DesignOutput` as context to the `coding` node.
- **Copy and content.** Button labels, marketing headlines, and body copy are `content-generation` work. The `design` agent will produce component names and descriptions, but should not be treated as a copywriting tool.
- **Tasks that require a live human designer review.** The `design` agent produces a machine-generated first draft. For brand-critical or accessibility-audited work, treat its output as a starting point and route through a human review gate.

---

### 2.5 `report`

#### Description

The `report` capability aggregates the structured outputs of upstream agents into a coherent, well-sectioned written document. It is always a **terminal node** in a DAG — it consumes results, never produces them for another agent. The reference implementation requires at least one `upstreamResults` entry and throws `InsufficientContextError` if none are provided.

Every report must contain exactly five sections with these headings (order enforced):

1. Executive Summary
2. Findings
3. Risk Analysis
4. Recommendations
5. Conclusion

A response from the LLM that omits any of these headings is treated as `VENICE_MALFORMED_RESPONSE` and rejected.

**Suitable agent types:** report-writing agents, executive-summary generators, PDF-export agents, presentation-slide builders.

#### Input Format

```typescript
interface AgentTask {
  taskId: string;
  nodeId: string;
  prompt: string;           // report title or framing instruction (required)
  context?: string;         // optional extra instructions (tone, audience, length)
  upstreamResults: unknown[]; // REQUIRED — at least one upstream agent result
}
```

The `upstreamResults` array is serialized to JSON and injected into the system prompt as structured context. The more structured and machine-readable the upstream outputs are (i.e., properly typed `ResearchOutput` and `RiskOutput` objects), the higher the quality of the generated sections.

#### Expected Output Schema

```typescript
interface Section {
  heading: string;        // one of the five mandatory headings (see above)
  content: string;        // markdown-formatted section body
  sourceAgents: string[]; // names of agents whose data informed this section
}

interface ReportOutput {
  title: string;
  sections: Section[];    // exactly 5, in mandatory order
  wordCount: number;      // computed post-generation by stripping punctuation
  generatedAt: string;    // ISO-8601 timestamp applied server-side, not by LLM
}
```

The `generatedAt` timestamp and `wordCount` are set by the reference implementation after the LLM responds — they are not trusted from the raw model output.

#### Latency

| Percentile | Range        | Notes                                                              |
|------------|--------------|--------------------------------------------------------------------|
| p50        | 6 – 12 s     | Two upstream results, moderate upstream data volume               |
| p95        | 20 – 40 s    | Large upstream JSON (e.g., 10+ risk items + dense research output) |

Report generation is typically the highest-latency step because the full serialized upstream context is included in every request. Callers should allow at least 60 s timeout.

#### Suggested XLM Pricing

| Tier    | Range (XLM) | Rationale                                                               |
|---------|-------------|--------------------------------------------------------------------------|
| Minimum | 0.5         | Minimal upstream context (single research result), short output         |
| Typical | 1.0         | Reference price; two upstream agents, full five-section report          |
| Premium | 2.0 – 3.0   | Agents offering PDF export, citation hyperlinking, or multi-language output |

The reference smart-contract agent registers at `priceXLM: 1`.

#### Example Prompts

1. `"Write an executive report on the feasibility of launching an AI agent marketplace on Stellar. Use the upstream research and risk assessments as the primary sources."`
2. `"Produce a due diligence summary for a Series A investor. Synthesize all upstream agent findings into a professional investment memo."`
3. `"Generate a technical post-mortem report covering the incident described in the upstream findings. Keep the tone neutral and actionable."`

#### When NOT to Use `report`

- **As the first or middle node in a DAG.** The `report` agent requires upstream input. Invoking it without `upstreamResults` throws `InsufficientContextError`. It is not a general-purpose summarizer — it is a synthesis terminal.
- **When a single-agent summary is sufficient.** If only one upstream agent ran and its output is already well-structured, returning that output directly is cheaper than routing through `report`. Use `report` when aggregation across multiple agent outputs is the value-add.
- **For structured data export.** If the consumer needs JSON, CSV, or a typed object (not a human-readable document), use the upstream agent's output directly rather than wrapping it in a report section.
- **Real-time or streaming output.** The `report` capability generates a complete document in a single request. It is not suitable for streaming partial results to a UI.

---

## 3. Custom Capability Registration

### 3.1 Naming Conventions

Custom capability names follow these rules (enforced at registration time):

| Rule              | Requirement                                                       |
|-------------------|-------------------------------------------------------------------|
| **Character set** | Lowercase ASCII (`a–z`), digits (`0–9`), underscores (`_`) only  |
| **Length**        | 3–32 characters inclusive                                         |
| **Case**          | All lowercase — no camelCase or PascalCase                        |
| **Separator**     | Underscore (`_`) between words (e.g., `market_research`)         |
| **No version suffix** | Encode version via the versioning mechanism in §4            |
| **Reserved names** | `research`, `risk`, `coding`, `design`, `report` are reserved for the built-in agents |

Valid examples: `market_research`, `legal_review`, `audio_transcription`  
Invalid examples: `MarketResearch` (uppercase), `market-research` (hyphen), `r` (too short), `my_company_super_specialized_nlp_model` (over 32 chars)

### 3.2 Step-by-Step Registration

**Step 1 — Define your output schema**

Write a TypeScript interface and a Zod schema for your agent's output. The schema must be fully self-contained: no circular references, no `any` types, no optional-only fields (at least one required field). Export the Zod schema so the coordinator's quality scorer can validate live output against it.

**Step 2 — Implement `getCapability()` and `getOutputSchema()`**

Extend `BaseAgent` (or implement the `Agent` interface directly):

```typescript
export class MarketResearchAgent extends BaseAgent {
  getCapability(): string {
    return 'market_research';
  }

  getOutputSchema(): z.ZodSchema {
    return MarketResearchOutputSchema;
  }

  async execute(task: AgentTask): Promise<MarketResearchOutput | AgentError> {
    // ...
  }
}
```

**Step 3 — Register the agent on-chain**

Call `POST /api/agents/register` with your agent record:

```json
{
  "agentId": "my-market-research-agent-1",
  "capabilities": ["market_research"],
  "pricingXLM": 1.5,
  "endpoint": "https://my-node.example.com/agents/market_research",
  "stellarPublicKey": "G..."
}
```

The registry contract persists the record in `Instance` storage and emits a `registered` event. The coordinator will start routing `market_research` tasks to your agent within one heartbeat interval (default: 30 s).

**Step 4 — Submit a schema PR (if sharing publicly)**

If you intend for your capability to be discoverable by third-party coordinators, open a PR against `smart-contracts/src/types/types.ts` adding your name to the `Capability` union and documenting the output interface. Follow the naming conventions above. The PR requires approval from two core maintainers.

**Step 5 — Verify**

```bash
# Check your agent appears in the registry
curl http://localhost:3001/api/agents?capability=market_research

# Confirm the coordinator can dispatch to it
curl -X POST http://localhost:3001/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"prompt": "test prompt", "capability": "market_research"}'
```

### 3.3 Schema Requirements

A valid capability schema must satisfy:

- At least one **required** top-level string or object field (not purely optional).
- All string fields that carry user-visible content must have `z.string().min(1)` (no empty strings).
- Arrays that are semantically required (e.g., risk items, findings) must carry `.min(1)`.
- No `z.any()` or `z.unknown()` at the top level — these defeat the quality scorer.
- If the output includes an enumerated `type` field, use `z.enum([...])` rather than `z.string()` to enable static analysis.

### 3.4 Review Process

Custom capabilities are accepted immediately at the registry level (no governance gate for private or single-operator use). To be listed in this taxonomy as a community capability:

1. Open a GitHub issue with label `capability-proposal` and fill in the description, use cases, output schema, and minimum bond.
2. A 7-day comment period follows.
3. Core team reviews for naming, schema quality, and overlap with existing capabilities.
4. If approved, a maintainer merges a PR adding it to this document and to `smart-contracts/src/types/types.ts`.

---

## 4. Versioning Policy

### 4.1 Versioning Scheme

Capability versions follow [Semantic Versioning](https://semver.org/) in the form `MAJOR.MINOR.PATCH`, but only the **MAJOR** component is part of the on-chain capability tag:

```
<capability_name>@v<MAJOR>
```

Examples: `research@v2`, `risk@v3`.

The unversioned tag (e.g., `research`) always resolves to the latest stable major version. Agents advertising the unversioned tag are assumed to implement the current stable schema.

### 4.2 When a Version Bump Is Required

| Change type                                               | Version bump required |
|-----------------------------------------------------------|-----------------------|
| Adding a **new required field** to the output schema      | Yes — MAJOR bump      |
| Removing any output field                                 | Yes — MAJOR bump      |
| Renaming a field                                          | Yes — MAJOR bump      |
| Changing a field's type (e.g., `string` → `number`)       | Yes — MAJOR bump      |
| Adding a new **optional** field to the output schema      | No                    |
| Widening an enum (new allowed value, old values unchanged)| No                    |
| Changing LLM routing or internal implementation detail    | No                    |
| Updating latency characteristics or pricing guidance      | No                    |

**Rule of thumb:** if a coordinator or downstream agent that was written against the previous schema would break when receiving the new output, it is a breaking change and requires a MAJOR bump.

### 4.3 Backward Compatibility Expectations

- Both the old and new major version must be listed as active in this document and in the registry for a minimum **90-day transition window** after the new version is released.
- During the transition window the coordinator prefers the new version but falls back to the old version if no upgraded agent is available.
- After the transition window the old version may be retired; retiring it removes it from the registry and coordinators will reject tasks that explicitly request the old version.
- Agents serving multiple major versions must register one record per version:

```json
[
  { "agentId": "risk-agent-1",    "capabilities": ["risk"],    "pricingXLM": 2 },
  { "agentId": "risk-agent-1-v2", "capabilities": ["risk@v2"], "pricingXLM": 2 }
]
```

### 4.4 Coordinator Version Resolution

When a task requests capability `research` (unversioned):

1. Prefer agents advertising `research` (current stable).
2. Fall back to agents advertising the highest available major version (`research@v2`, then `research@v1`).
3. Honor an explicit `capabilityVersion` field in the task payload when provided.

---

## 5. Capability Compatibility Matrix

This matrix shows which capabilities can be directly chained (the upstream capability's output is passed as `upstreamResults` or `context` to the downstream capability). "✅ Valid" means the data contract is well-defined; "⚠️ Caveat" means chaining is possible but requires care; "❌ Not recommended" means the data contracts are incompatible or the combination rarely produces useful output.

| Upstream →       | `research` | `risk` | `coding` | `design` | `report` |
|------------------|:----------:|:------:|:--------:|:--------:|:--------:|
| **`research`**   | —          | ✅     | ⚠️        | —        | ✅       |
| **`risk`**       | —          | —      | —        | —        | ✅       |
| **`coding`**     | —          | —      | —        | ⚠️        | ❌       |
| **`design`**     | —          | —      | ⚠️        | —        | ⚠️        |
| **`report`**     | ❌         | ❌     | ❌        | ❌       | —        |

### Compatibility Notes

**`research → risk` (✅ Valid)**  
The canonical two-node upstream chain. The `ResearchOutput` (summary, keyFindings, sources) provides grounded factual context that the risk agent uses to produce evidence-backed `RiskItem` entries rather than relying purely on LLM priors. Pass the research result in `context` or `upstreamResults`.

**`research → report` (✅ Valid)**  
Research output alone is sufficient for a `report` node. The report agent will populate the Findings and Executive Summary sections from the research output, though the Risk Analysis section will be thin without a prior `risk` node.

**`risk → report` (✅ Valid)**  
Risk output alone can feed a report, but the report will lack factual citations unless a `research` node also ran upstream. Best used as part of the full `research → risk → report` chain.

**`research → risk → report` (✅ Valid — canonical full chain)**  
The reference three-node pipeline. The coordinator should pass both `research` and `risk` outputs in `upstreamResults` to the `report` node so all five mandatory sections are well-populated.

**`design → coding` (⚠️ Caveat)**  
The `DesignOutput` schema (wireframes, colorPalette, componentHierarchy, assetManifest) provides a useful scaffold for a `coding` agent to generate React components or CSS tokens. However, the data contract between the two schemas is informal — there is no shared type that the `coding` agent's prompt parser is guaranteed to understand. Callers must translate the `DesignOutput` JSON into a natural-language coding prompt or structured `context` block before dispatching the `coding` task. Direct JSON pass-through without prompt translation produces lower-quality code output.

**`design → report` (⚠️ Caveat)**  
A `report` agent can describe a design specification in prose (useful for design-review documents or accessibility reports), but the mandatory Risk Analysis and Findings sections will be awkward without prior research or risk inputs. This chain is appropriate only for narrowly scoped design-review reports where the report agent's prompt explicitly frames the sections around the design spec.

**`coding → design` (⚠️ Caveat)**  
Passing existing code as context to a `design` agent (to reverse-engineer a design spec from an implementation) is technically supported but produces variable quality. This is an unconventional direction of dependency.

**`report → *` (❌ Not recommended)**  
The `report` capability is a terminal node. Its output is a human-readable document, not a structured data type designed for machine consumption by other agents. Routing a `ReportOutput` as `upstreamResults` to another agent (including another `report` agent) will produce degraded results and wastes XLM.

### Common Pipeline Patterns

| Pipeline                    | DAG Chain                                   | Typical Use Case                                |
|-----------------------------|---------------------------------------------|-------------------------------------------------|
| Quick Research Summary      | `research → report`                         | Single-topic briefing with no risk component    |
| Risk Snapshot               | `risk → report`                             | Fast risk scorecard when facts are already known|
| Full Due Diligence          | `research → risk → report`                  | Investment or launch readiness assessment       |
| Design-to-Code Handoff      | `design → coding`                           | UI spec → component scaffold (requires prompt translation) |
| Product Launch Assessment   | `research → risk → report` (parallel design)| Research and design run in parallel, risk runs after research |

---

## 6. Glossary

### `assetManifest`
An array of `AssetEntry` objects in the `DesignOutput` schema. Each entry describes a visual asset (icon, image, font) needed by the design — its type, name, description, and suggested dimensions — without encoding the asset binary itself. Consumers use the manifest to source or commission the actual files.

### `capability`
The string tag an agent advertises at registration time, used by the Coordinator as the primary dispatch key when matching tasks to agents. Defined in `smart-contracts/src/types/types.ts` as a union of the five reserved names plus `string` for extensions. See §1.

### `colorToken`
A single entry in the `colorPalette` array of `DesignOutput`. Each token has a semantic `name` (e.g., `primary-500`), a `hex` value validated against `/^#[0-9A-Fa-f]{6}$/`, and a `usage` description. Tokens form the design system's color contract between the design spec and the implementation.

### `componentHierarchy`
The `componentHierarchy` array in `DesignOutput` describes the tree structure of UI components: each `ComponentNode` names a component, lists its children by name, and optionally lists its prop names. It is a flat adjacency representation of a component tree rather than a nested object — consumers must reconstruct the tree if needed.

### `compositeScore`
A numeric ranking metric maintained by the registry for each agent-capability pair, computed as:

```
compositeScore = reputationScore / (priceXLM + ε)
```

where `ε = 0.0001` prevents division by zero for free agents. A higher score means the agent is simultaneously cheaper and more reputable. The registry keeps each capability's bucket sorted descending by `compositeScore` so the best candidate is always at index 0 of `lookupAgentsComposite()`.

### `confidence_score`
The `confidence` field on `ResearchOutput`, a float in `[0, 1]` derived deterministically from the number of cited sources (`deriveConfidence(sourceCount)`): 0.3 for zero sources, 0.6 for 1–3 sources, 0.9 for four or more. It is not a self-reported LLM confidence value.

### `critical` (flag)
A boolean field on `RiskItem`. Set to `true` by the reference `RiskAgent` implementation (not by the LLM) when `likelihood >= 4` AND `impact >= 4` on the 1–5 scales. Critical items should be surfaced prominently in any downstream report or dashboard.

### `DAGNode`
A single unit of work in a Directed Acyclic Graph of agent tasks. Defined in `smart-contracts/src/types/types.ts`:

```typescript
interface DAGNode {
  id: string;
  taskType: Capability;      // which capability to dispatch
  dependsOn: string[];       // ids of upstream DAGNodes whose output is needed
  assignedAgent?: AgentRecord;
  status: DAGNodeStatus;     // 'pending' | 'running' | 'completed' | 'failed'
  result?: AgentResult;
}
```

The Coordinator builds a DAG of `DAGNode` objects, resolves execution order via topological sort, and dispatches each node when its `dependsOn` nodes have all reached `completed` status.

### `dataSources`
In the smart-contracts layer's `ResearchOutput` interface (`smart-contracts/src/agents/research/research.ts`), `dataSources` is an array of strings representing source identifiers or URLs. In the backend layer, the equivalent field is `sources`, an array of `{ url, title }` objects. Downstream consumers should normalize to whichever representation the upstream agent produces.

### `escrow`
A Stellar Claimable Balance created by the payment module to hold XLM on behalf of a task until the work is verified complete. The coordinator creates the escrow at task dispatch and the payment module releases it to the agent's `stellarAddress` after successful task settlement. Implemented in `smart-contracts/src/payment/payment.ts`.

### `impact`
The second dimension of a `RiskItem`'s severity rating. An integer from 1 (negligible consequence) to 5 (severe or catastrophic consequence) if the risk materializes. Combined with `likelihood` to determine the `critical` flag.

### `keyFindings`
An array of concise, non-empty strings on `ResearchOutput`, each representing a discrete, verifiable finding from the research. At least one entry is required. These are the primary input to downstream `risk` and `report` nodes — the `risk` agent uses them to ground risk descriptions in evidence, and the `report` agent surfaces them in the Findings section.

### `likelihood`
The first dimension of a `RiskItem`'s severity rating. An integer from 1 (very unlikely) to 5 (near-certain) representing the probability that the risk materializes within the analysis horizon. The reference `RiskAgent` expects the LLM to self-report this value; it is not independently computed.

### `overallRiskScore`
A float on `RiskOutput` in the range `[0, 5]`, representing a weighted average risk level across all `RiskItem` entries. The reference implementation delegates computation to the LLM via the system prompt. Consumers should treat it as an indicative headline figure rather than a precise actuarial value.

### `priceXLM`
The per-task price an agent charges, denominated in XLM and stored as a `number` on `AgentRecord`. Used in the `compositeScore` calculation. The registry's composite index treats lower `priceXLM` as better (all else equal). Monetary transfers are handled internally as BigInt `stroops` to avoid floating-point rounding errors.

### `reputationScore`
A float in `[0, 1]` on `AgentRecord` representing the agent's historical task success rate. Defaults to `1` for newly registered agents. The Coordinator updates it after each task outcome (increment on success, decay on failure). Used in the `compositeScore` calculation — higher is better.

### `RiskItem`
The per-risk record within `RiskOutput`. Full definition:

```typescript
interface RiskItem {
  category: string;      // e.g. 'Market', 'Technical', 'Regulatory'
  description: string;
  likelihood: number;    // integer 1–5
  impact: number;        // integer 1–5
  mitigations: string[];
  critical: boolean;     // likelihood >= 4 AND impact >= 4
}
```

### `stroops`
The smallest unit of XLM: 1 XLM = 10,000,000 stroops (10⁷). All monetary values in the payment module are handled as `BigInt` stroops internally to eliminate floating-point arithmetic errors. Display conversions use `stroopsToXlm()` and `xlmToStroops()` from `smart-contracts/src/payment/payment.ts`.

### `VaR` (Value at Risk)
A statistical measure of the maximum expected loss over a given time horizon at a specified confidence level. Not computed by the built-in `risk` capability (which uses a qualitative 1–5 scale), but referenced in the premium tier of risk agents that integrate with quantitative financial-modelling pipelines.

### `wireframe`
A single entry in the `wireframes` array of `DesignOutput`. Each `WireframeSection` describes a logical screen region by name, provides a prose description, and lists the component names present in that region. Wireframes in ai-net are textual/structural descriptions, not image files or SVG.
