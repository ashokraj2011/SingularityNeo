# SingularityNeo — Stakeholder & Sales Pitch

> Dual-purpose deck: use as internal leadership alignment and as an external sales narrative.
> Each section is one slide. Bullets are slide content. *Italic blocks are speaker notes.*
> Recommended format: 16:9, 16 slides, 20-minute read-through.

---

## Slide 1 — Title

# SingularityNeo
### The AI-Native Cockpit for Engineering Teams

**Provable autonomy. Every agent action carries its receipts.**

*Speaker note: Open with the tagline. Don't describe features. Set the frame that this is about trust + autonomy, not another copilot.*

---

## Slide 2 — The Moment

## AI is about to hit the autonomy trust cliff.

- Agents can now write code, run tests, open PRs, transition tickets
- But engineering leaders cannot answer four questions:
  1. **What was the agent allowed to do?**
  2. **What context did it actually read?**
  3. **What decision did it make, and why?**
  4. **Can I replay it for my auditor, my CISO, my board?**
- Without those answers, autonomy stalls at "toy project" scale

*Speaker note: Every buyer in this space is nervous. Naming the fear gives us permission to sell the cure.*

---

## Slide 3 — The Market Has Three Camps — None of Them Solve It

| Camp | Examples | Optimized For | What's Missing |
|---|---|---|---|
| **Coder Copilots** | Cursor, Copilot, Windsurf | Keystroke speed | No org intent, no memory, no audit |
| **Autonomous Agents** | Devin, Factory, Replit Agent | Task completion | Opaque reasoning, "trust me" |
| **Work Trackers + AI** | Linear, Jira, ServiceNow AI | Governance, tracking | Agents can't do the work |

**No one fuses execution + governance + evidence in one substrate.**

*Speaker note: Draw the triangle on the whiteboard if live. Pause. Let the gap land.*

---

## Slide 4 — The Differentiator

# Replayable Provenance,
# bound to a Signed Capability Contract.

Every agent action in SingularityNeo is:

1. **Bound** to a human-signed capability contract
2. **Executed** under a declared role policy (tools, memory, quality bar)
3. **Written** to a unified, append-only timeline
4. **Packaged** as a content-addressed, replayable evidence bundle

**Not a compliance layer. The substrate.**

*Speaker note: This is the core slide. Memorize it. Say it the same way every time.*

---

## Slide 5 — What That Means in One Sentence

> "Yes, agents shipped 40% of this quarter's work — and here is the exact contract they worked to, the exact tools they were allowed to call, the exact context they read, the exact decisions they made, and I can replay any of it in one click."

**That sentence is what engineering leaders want to say.**
**SingularityNeo is the only product that lets them say it truthfully.**

*Speaker note: Ask the room: "Can you say this today about your AI tools?" Silence sells the product.*

---

## Slide 6 — Four Substrate Ingredients. One Brain.

| Ingredient | What It Is | Why It's Hard |
|---|---|---|
| **Capability Contract** | Human-signed outcome, DoD, boundary, owner — before any run | Requires hierarchy + versioning, not a prompt |
| **Role Policy** | Declared tool allow/deny + memory scope + quality bar per agent role | Requires runtime enforcement, not prompt tricks |
| **Unified Timeline** | Chat, thoughts, tool calls, retrievals, artifacts, approvals — one stream | Requires fusing runtime telemetry into the UX |
| **Evidence Packet** | Content-addressed, replayable bundle, shareable via URL | Requires deterministic capture from day one |

**Cursor has #3 partially. Devin has #2 partially. Jira has #1 partially. Nobody has all four.**

*Speaker note: The "partially" column is the punchline. Competitors can't bolt these on — they'd have to rewrite their core.*

---

## Slide 7 — The Product Story: One Cockpit

Not a dashboard. Not a chat sidebar. **A cockpit.**

- One work item = one session
- Plan, chat, runs, tools, evidence, learning — **one frame, one stream**
- Every agent turn shows: role · tools used · context read · decision · citations
- A run is not a different page — it's a live block in the timeline
- No tab-switching to approve, upload, or read an artifact

**The competition is "many tabs." We are one brain.**

*Speaker note: If doing a live demo, this is where you open the Cockpit. Don't narrate features — just use it. Let the unified stream sell itself.*

---

## Slide 8 — The Ten-Minute Wow

### Golden path from install to shareable evidence

1. Install / open app — **30 s**
2. Connect GitHub repo — **60 s**
3. Approve workspace root — **30 s**
4. Agents read repo, propose capability contract — **90 s**
5. Pull a real issue as a work item — **60 s**
6. Run the default workflow — **3 min**
7. **Evidence packet generated, permalink copied to clipboard**

**Paste the permalink into a PR or Slack. That link *is* the marketing.**

*Speaker note: Prospects never forget the moment the evidence URL lands in Slack. Make them experience it.*

---

## Slide 9 — Agent Differentiation You Can See

Every built-in role has **declarative, enforced** differences:

- **OWNER** — approves contracts, no direct code writes
- **ARCHITECT** — writes to capability memory, full read scope
- **BUILDER** — code + test tools, cannot self-approve
- **REVIEWER** — read-only, must cite ≥3 sources, cannot modify files
- **CRITIC** — contrarian mode required, must disagree before signing off
- **OPERATOR** — runtime only, no design tools

**Role chips appear on every agent turn in the timeline. Difference is observable, not implied.**

*Speaker note: "Why do I need five agents instead of one ChatGPT?" This is the answer. They're not different prompts — they're different policies.*

---

## Slide 10 — Safety That Precedes Orchestration

### The Capability Readiness Contract

A workflow cannot run until six gates are green:

```
✓ Repo connected
✓ Workspace root approved
✓ Owner assigned (human)
✓ Outcome statement
✓ Definition of Done (≥3 testable checks)
✓ Minimal contract published
```

**Below 6: agents can reason, summarize, critique — but cannot act.**
**At 6: autonomy unlocks, with policy enforcement and evidence capture.**

*Speaker note: This is why our agents don't go rogue. The gate is the product.*

---

## Slide 11 — The Evidence Packet

### Every run produces a shareable, replayable bundle

Contains:
- The capability contract the run executed against
- The role policies that were enforced
- Every tool call, with inputs and outputs
- Every retrieval, with sources
- Every decision, with citations
- Every artifact, content-addressed
- Human approvals and overrides

**Exportable to ALM, auditors, regulators. Permalink for PRs and Slack.**

*Speaker note: Hold up a printed evidence packet if in person. Physical object sells digital provenance.*

---

## Slide 12 — Why Now

- **Model capability is commoditizing** — autonomy is no longer science fiction
- **Regulation is catching up** — EU AI Act, SR-11-7, ISO 42001 all require decision traceability
- **Enterprise buyers are burned** — 2024–2025 pilots exposed the trust gap
- **Coding tools are table stakes** — the next buying cycle is about governed autonomy
- **The substrate takes 12–24 months to build** — the window to own this is now

*Speaker note: If asked "why won't OpenAI/Cursor do this?" — they can't, without rewriting. The substrate is the moat.*

---

## Slide 13 — The Moat

### It isn't the AI. It's the substrate.

- Capability hierarchy
- Role policy runtime
- Unified interaction timeline
- Content-addressed evidence store
- Readiness contract as a first-class object

**Competitors started with a chat box or a code editor.**
**We started with the ledger.**

**You can add a chat box to a ledger. You can't add a ledger to a chat box.**

*Speaker note: This is the line to close an investor or a skeptical CTO. Deliver it slowly.*

---

## Slide 14 — Who Buys

### Primary buyer: VP Engineering / Head of Platform

**They feel three pains:**
1. Scattered AI tool sprawl with no audit trail
2. CISO and Risk blocking broader AI rollout
3. Pressure to show AI-driven velocity gains to the board

**We give them:**
- One cockpit that consolidates the sprawl
- An evidence trail that unblocks CISO
- A quarterly "Agent Review Report" that ships to the board

### Secondary champions: Engineering Managers, Staff Engineers, Compliance

*Speaker note: Sell to the VP. Demo to the Staff Engineer. Ship proof to the CISO.*

---

## Slide 15 — The Business Case

| Metric | Without SingularityNeo | With SingularityNeo |
|---|---|---|
| AI adoption ceiling | Pilot / sandbox | Production-wide |
| Audit readiness | Manual reconstruction | One-click export |
| Agent-shipped work | Unreported / unsafe | Measured + governed |
| Tool sprawl | 4–7 tools | 1 cockpit |
| Time-to-first-value | Weeks | **10 minutes** |

**The ROI isn't "faster coding." It's "AI you can actually deploy org-wide."**

*Speaker note: Don't compete on lines-of-code savings. Compete on the autonomy ceiling you just raised.*

---

## Slide 16 — Call to Action

## See it in 10 minutes.

- **Prospects:** Live golden-path demo — your repo, your issue, a real evidence packet
- **Stakeholders:** 2-week pilot with one team, one capability, measurable before/after
- **Investors / Board:** Quarterly Agent Review Report from the pilot team

### One line to leave the room with:

> **Everyone else sells agent speed. We sell agent receipts — and in enterprise engineering, receipts are what actually unlock adoption at scale.**

*Speaker note: End on the receipts line. Don't add anything after it.*

---

## Appendix A — One-Slide Version (if you only get 60 seconds)

> SingularityNeo is the AI-native cockpit for engineering teams.
> We're the only product where every agent action is bound to a human-signed capability contract, executed under an enforced role policy, captured in a unified timeline, and packaged as a replayable evidence bundle.
> Cursor sells speed. Devin sells autonomy. Jira sells governance.
> We sell **provable autonomy** — and that's what unlocks AI adoption at enterprise scale.

---

## Appendix B — Objection Handling

| Objection | Response |
|---|---|
| "We already have Copilot." | Copilot is a keystroke tool. It has no contract, no role policy, no evidence trail. Use it *inside* the Cockpit. |
| "Can't you just add audit to Cursor?" | You can add logs. You can't add a capability hierarchy, role-enforced tool policy, or a signed contract model without rewriting. |
| "Our compliance team will never approve AI agents." | Start with the evidence packet. That's the artifact your compliance team has been asking every other AI vendor to produce. |
| "How is this different from LangSmith / Langfuse?" | Those are developer-facing traces. This is a product end users (engineers + leaders) live in. Traces are an ingredient; the cockpit is the meal. |
| "Why not build in-house?" | You can. It will take 18–24 months, two platform teams, and the loss of the market window. |
| "What about open-source frameworks (LangGraph, AutoGen)?" | Frameworks for building agents. Not products for running a team on agents. Different category. |

---

## Appendix C — Demo Script Skeleton (10 minutes)

1. **(0:00)** Open the app — show three surfaces only: Home, Cockpit, Studio
2. **(0:30)** Connect GitHub → approve workspace
3. **(1:30)** Agents propose capability contract from repo — approve it live
4. **(3:00)** Pull a real GitHub issue as a work item, land in the Cockpit
5. **(3:30)** Type one sentence of intent — workflow begins
6. **(4:00)** **Show the timeline:** role chips, tool calls expanding inline, knowledge lens updating on the right
7. **(6:00)** Reviewer agent disagrees with the Builder — show contrarian mode in action
8. **(7:00)** Human approves the decision in the timeline — no tab switch
9. **(8:00)** Run completes → evidence packet permalink auto-copied
10. **(8:30)** Paste permalink in a Slack channel → replay the entire run from the link
11. **(9:30)** Show Studio once to prove agent role table exists — close it
12. **(10:00)** "That's it. One cockpit. One brain. One receipt per run."

---

*Document version: 1.0 · For internal stakeholder review and external sales conversations · Derived from product strategy sessions*
