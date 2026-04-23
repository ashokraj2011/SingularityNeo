# SingularityNeo: Enterprise Architecture Deep-Dive

This document provides a detailed breakdown of the two core subsystems powering the SingularityNeo platform: the **Token Optimization Framework** and the **Agent Learning Model**. 

Together, these systems shift the platform from a standard code-generation tool to a continuous, cost-optimized, and enterprise-governed autonomous engineering organization.

---

# Part 1: Token Optimization Framework

The Token Optimization strategy in SingularityNeo attacks token waste across all three phases of an LLM generation: **Input (what the agent sees), Execution (how long sessions are remembered), and Output (what the agent types back).**

It is constructed upon a 9-lever framework.

## Strategy 1: Input Truncation 
*Goal: Stop unnecessary tokens from ever entering the `System Prompt`.*

**1. Phase-Sliced Guidance**
Historically, agents were loaded with a massive `repo-instructions.md` file containing everything from deployment rules to database schemas. Now, SingularityNeo filters the injected rules based on the active SDLC phase. A `BUILD` phase developer agent never pays the input-token cost to read the `GOVERNANCE` or `RELEASE` policies.

**2. Semantic Hunk Reads (`workspace_read`)**
Instead of dumping a 3,000-line file into the prompt because an agent wants to fix a 10-line function, the `codeIndex` uses the native TypeScript AST compiler. When an agent requests a `symbol`, the backend mathematically extracts the `sliceStartLine` to `sliceEndLine` and injects *only* that function hunk into the prompt. This easily saves 80–95% of input tokens on monolithic files.

**3. The Context Budgeter**
You replaced raw text concatenation with a brutal, mathematically precise **Eviction Engine**. The engine applies strict token limits based on the active phase (e.g., `BUILD` gets 64k tokens, `RELEASE` gets 16k). If the context window hits the ceiling, it drops items based on Priority:
1. SYSTEM_CORE (Never dropped)
2. PHASE_GUIDANCE
3. WORK_ITEM_BRIEFING
4. RECENT_CHAT_HISTORY
5. CODE_HUNKS (LRU algorithm drops oldest read files first)
6. MEMORY_HITS (Lowest vector similarity dropped first)

## Strategy 2: Execution Compression
*Goal: Prevent long-running autonomous tasks from expanding the context window to infinity.*

**4. Tool-Loop History Rollup**
If an agent loops 20 times trying to fix a bug, standard clients pass all 20 historical turns back to the LLM on turn 21, burning massive amounts of tokens. SingularityNeo intercepts `localMessages`. When the array hits ~10 turns, it passes the oldest turns to a dirt-cheap model (like `gpt-4o-mini`) to compress the history. 

**5. Structured Rollup Output**
The cheap budget model explicitly outputs a highly compressed JSON state note: `{"currentGoal": "...", "lastAction": "...", "blocker": "...", "files_in_play": [...]}`. This JSON string is injected into the top of the prompt, meaning the expensive execution agent maintains perfect state awareness while only paying for the last 6 raw turns of history.

**6. Multi-Symbol Retrieval Bundles**
By allowing an agent to pass `includeCallers` and `includeCallees` to the `workspace_read` tool, you eliminate the need for the agent to make 3 separate, expensive tool-call loops to figure out what breaks when they change a function. They get the target function and the top exported signatures of its dependencies in a single, cheap payload.

## Strategy 3: Output Constraints
*Goal: Force the LLM to type as few characters as mathematically possible.*

**7. Diff-First Prompting**
LLMs naturally want to rewrite entire files. The system prompts aggressively steer the agent towards using `workspace_apply_patch` or `workspace_replace_block`, actively discouraging them from printing entire modified file bodies. 

**8. Diff Enforcement Policy**
If an agent calls `workspace_write` on an existing file *twice*, SingularityNeo traps the response and throws a recoverable error back to the agent: `"workspace_write refused... Use workspace_apply_patch or workspace_replace_block"`. It hard-blocks the token bleed, violently pushing the agent toward producing unified diffs. 

**9. Prompt Receipts (Telemetry)**
Finally, the platform generates a `PROMPT_RECEIPT` for every main-model call. This tracks exactly which fragments were included, evicted, and how many tokens were burned. This provides ultimate observability to prove the financial ROI of SingularityNeo.

---

# Part 2: The Agent Learning Model

While most coding assistants suffer from "Goldfish Memory" (they forget everything the moment you close the IDE), the SingularityNeo Learning Model is built as a **Continuous Intelligence Engine**. It studies past executions, learns from mistakes, and instantly absorbs human feedback.

Here is how the 5 pillars of the Learning Model operate:

## 1. The Four-Tiered Memory Hierarchy
Instead of treating all context equally, SingularityNeo moves data through semantic "temperature" tiers:
*   **HOT (Active Session):** The immediate, uncompressed chat log and active file state. 
*   **WARM (Recent Runs):** Recently completed Work Items and newly ingested codebase features. These rank highly in vector searches.
*   **COLD (Historical):** Older decisions and solved bugs that are archived for deep semantic retrieval, but isolated so they don't pollute the fast paths.
*   **ARCHIVE:** Aged-out records (cleared by TTL schedulers) that are no longer mathematically relevant to the active codebase.

## 2. The Distillation Engine
Agent loop transcripts are incredibly messy. SingularityNeo runs a background **Distillation Engine**. Instead of saving raw transcripts, it passes the completed session to a background model which extracts only the *pure signal*: "What was the goal? What error occurred? What was the successful fix?" 
It writes this "Lesson" as a durable Memory Document. The next time an agent hits a similar error, it pulls the distilled lesson, immediately bypassing the failed attempts it made last month.

## 3. Graceful Vector Storage (RAG Pipeline)
When an agent starts a task, it needs to rapidly query the Memory Documents to see if it has solved this before.
*   **pgvector First:** If the enterprise has a Postgres database running `pgvector`, SingularityNeo executes blazing-fast Approximate Nearest Neighbor (ANN) searches natively in the DB.
*   **JSON-Cosine Fallback:** If you are running locally without advanced infrastructure, the platform *gracefully degrades* to calculating cosine similarity in raw JSON/TypeScript math. The agent still gets semantic search, keeping the product 100% operational in any environment. 

## 4. The Human Operations Contract
AI occasionally distills the "wrong lesson" (e.g., it thinks a bad workaround is acceptable). This is where the **Operations Contract** takes over. 
When an Operator corrects an agent, that correction is pushed directly into the Operations Contract. During Prompt Injection, this Contract is injected *at the very top* of the System Prompt, structurally superseding any AI-generated memories. This guarantees that human "Tribal Knowledge" acts as the ultimate guardrail against AI hallucination loops.

## 5. Incremental & Symbol-Deep Indexing
When the underlying codebase changes, you don't rescan the entire monolithic repository. 
*   **Incremental Hashing:** The ingest engine hashes file checkpoints. Only files that have explicitly changed are passed through the parsing and vector embedding flow, saving massive API costs and CPU time. 
*   **Symbol-Level Depth:** Because of the `tree-sitter`/TypeScript compiler integration, your learning mechanism doesn't just map "Files". It maps the Directed Edge Graph: "Symbol `login` CALLS Symbol `validate`". When learning about a specific function, the agent pulls down its exact network of architectural dependencies automatically.
