# Singulairy Mermaid Diagram Pack

This document gives you high-level Mermaid diagrams for the main product ideas in Singulairy.

The diagrams are intentionally layered:

- Level 0: enterprise and collection view
- Level 1: capability operating model
- Level 2: workflow design view
- Level 3: work item progress view
- Level 4: developer cockpit and AI behavior
- Level 5: evidence, publishing, and ALM rollup

You can copy these into docs, demos, architecture decks, and Confluence with minimal cleanup.

## 1. Capability Landscape

This shows how collections, delivery capabilities, and shared capabilities fit together at the enterprise level.

```mermaid
flowchart TD
  CITY["City Plan / Enterprise Architecture"]
  DOMAIN["Business Domain Collection"]
  PLATFORM["Platform Layer Collection"]
  PORTFOLIO["ALM Portfolio Collection"]

  CAPA["Delivery Capability: Payments API"]
  CAPB["Delivery Capability: Settlement Engine"]
  CAPC["Delivery Capability: Customer Identity"]
  CAPD["Delivery Capability: Release Governance"]

  CITY --> DOMAIN
  CITY --> PLATFORM
  CITY --> PORTFOLIO

  DOMAIN --> CAPA
  DOMAIN --> CAPB
  PLATFORM --> CAPD

  DOMAIN -. "shared capability reference" .-> CAPC
  PLATFORM -. "shared capability reference" .-> CAPC
  PORTFOLIO -. "published contract rollup" .-> CAPA
  PORTFOLIO -. "published contract rollup" .-> CAPB
  PORTFOLIO -. "published contract rollup" .-> CAPD
```

## 2. Capability Operating Model

This is the core capability-centered picture: one capability acting as the operating unit for delivery.

```mermaid
flowchart LR
  CAP["Capability"]

  META["Business Charter
  Outcome
  Definition of Done
  Policy"]
  AGENTS["Agents
  Skills
  Learning"]
  WF["Workflow
  Lifecycle
  Phase Rules"]
  WORK["Work Items
  Runs
  Waits
  Approvals"]
  EVID["Evidence
  Artifacts
  Audit
  Ledger"]
  EXT["Connectors
  Jira
  Confluence
  GitHub
  ALM"]

  CAP --> META
  CAP --> AGENTS
  CAP --> WF
  CAP --> WORK
  CAP --> EVID
  CAP --> EXT
```

## 3. Collection vs Delivery Capability

This shows the difference between a collection capability and a delivery capability.

```mermaid
flowchart TD
  COLL["Collection Capability"]
  DEL["Delivery Capability"]

  COLL --> C1["Hierarchy owner"]
  COLL --> C2["Direct children"]
  COLL --> C3["Shared capabilities"]
  COLL --> C4["Published contract rollups"]
  COLL --> C5["ALM summary"]

  DEL --> D1["Owns workflows"]
  DEL --> D2["Owns work items"]
  DEL --> D3["Owns execution runs"]
  DEL --> D4["Owns evidence and approvals"]
  DEL --> D5["Publishes versioned contract snapshots"]
```

## 4. Workflow Designer Sample

This sample uses a delivery workflow with a typical engineering lane and one approval gate.

```mermaid
flowchart LR
  START["Start Work Item"]
  DISC["Discover / Clarify"]
  DESIGN["Design"]
  IMPL["Implement"]
  BUILD["Build & Test"]
  REVIEW["Approval Gate"]
  RELEASE["Release / Publish"]
  DONE["Done"]

  START --> DISC
  DISC --> DESIGN
  DESIGN --> IMPL
  IMPL --> BUILD
  BUILD --> REVIEW
  REVIEW -->|Approved| RELEASE
  REVIEW -->|Request Changes| IMPL
  RELEASE --> DONE
```

## 5. Workflow Designer View With Contracts

This view shows how the designer connects agents, tools, and artifact contracts.

```mermaid
flowchart TD
  STEP["Workflow Step"]

  AG["Assigned Agent"]
  TOOLS["Allowed Tools"]
  IN["Required Inputs"]
  OUT["Expected Outputs"]
  WAIT["Wait / Approval Rule"]
  OWN["Phase Owner / Team Rule"]

  STEP --> AG
  STEP --> TOOLS
  STEP --> IN
  STEP --> OUT
  STEP --> WAIT
  STEP --> OWN
```

## 6. Work Item Progress

This shows the work item lifecycle from intake to completion, including blocked and waiting states.

```mermaid
stateDiagram-v2
  [*] --> Backlog
  Backlog --> Ready
  Ready --> InProgress
  InProgress --> WaitingForInput
  InProgress --> WaitingForApproval
  InProgress --> Blocked
  WaitingForInput --> InProgress
  WaitingForApproval --> InProgress
  Blocked --> InProgress
  InProgress --> Validation
  Validation --> InProgress: "request changes"
  Validation --> Done
  Done --> [*]
```

## 7. Work Item Collaboration With Shared Branch

This view matches the newer multiuser model: the work item is the shared
object, not a single local workspace. For repo-backed work, the shared
branch name is the exact `workItem.id`.

```mermaid
flowchart LR
  WI["Work Item"]
  BR["Shared Work Item Branch"]
  ART["Artifacts + Evidence"]
  TL["Timeline + Logs"]
  HO["Handoff Packet"]

  UA["User A Session"]
  UB["User B Session"]

  WI --> BR
  WI --> ART
  WI --> TL
  WI --> HO

  UA --> WI
  UB --> WI

  UA -. "take control / write claim" .-> BR
  UB -. "review / guide / approve" .-> WI
  HO -. "transfer context" .-> UB
```

## 7a. User-Scoped Desktop Workspace Resolution

This shows how local execution paths are resolved now: per operator, per
desktop, with repository mappings taking precedence over the capability
fallback.

```mermaid
flowchart TD
  OP["Current Operator"]
  EX["Desktop Executor"]
  CAP["Capability"]
  REPO["Repository (optional)"]

  MAP1["Desktop mapping
  (executor + user + capability + repository)"]
  MAP2["Desktop fallback
  (executor + user + capability)"]
  ROOT["Validated local root"]
  WD["Working directory
  inside local root"]
  CLAIM["Claim / branch / local git execution"]

  OP --> MAP1
  EX --> MAP1
  CAP --> MAP1
  REPO --> MAP1

  OP --> MAP2
  EX --> MAP2
  CAP --> MAP2

  MAP1 -->|preferred| ROOT
  MAP2 -->|fallback| ROOT
  ROOT --> WD
  WD --> CLAIM
```

## 8. Developer Cockpit / Workbench

This is the main operating surface idea for `Work`.

```mermaid
flowchart TD
  COCKPIT["Developer Cockpit"]

  STATE["Current Work Item State"]
  BRIEF["Capability Briefing"]
  CONTRACT["Current Stage Contract"]
  CHAT["Direct Agent Chat"]
  TIMELINE["Unified Interaction Timeline"]
  KNOW["Knowledge Lens"]
  ACTIONS["Guide / Restart / Approve / Provide Input"]

  COCKPIT --> STATE
  COCKPIT --> BRIEF
  COCKPIT --> CONTRACT
  COCKPIT --> CHAT
  COCKPIT --> TIMELINE
  COCKPIT --> KNOW
  COCKPIT --> ACTIONS
```

## 9. Chat + Tools + Logs + Learning

This shows the intelligent chat loop you asked for: chat should understand work items, inspect logs, and interpret what happened.

```mermaid
sequenceDiagram
  participant User
  participant Chat
  participant Context as "Capability Context"
  participant Runtime as "Desktop Runtime / Agent"
  participant Map as "Desktop Workspaces"
  participant Tools
  participant Feed as "Interaction Timeline"
  participant Learn as "Learning Engine"

  User->>Chat: "Why did WI-104 fail?"
  Chat->>Context: Resolve work item, run, branch, stage
  Context->>Map: Resolve local root + working directory for current operator
  Map-->>Context: Validated desktop-local path
  Context->>Runtime: Send briefing + work item logs + tool traces
  Runtime->>Tools: Inspect relevant tool output if needed
  Tools-->>Runtime: Build/test/log results
  Runtime-->>Feed: Chat turn + tool events + reasoning summary
  Runtime-->>Learn: Capture learning delta
  Runtime-->>Chat: Explain failure, root cause, next step
  Chat-->>User: Interpreted answer with evidence
```

## 10. Evidence And Approval Loop

This shows how output becomes reviewable proof.

```mermaid
flowchart LR
  RUN["Execution Run"]
  ART["Artifacts"]
  PACK["Review Packet"]
  APPROVAL["Approval Gate"]
  LEDGER["Ledger / Audit"]
  RELEASE["Release Decision"]

  RUN --> ART
  ART --> PACK
  PACK --> APPROVAL
  APPROVAL -->|Approved| RELEASE
  APPROVAL -->|Rejected| ART
  RUN --> LEDGER
  ART --> LEDGER
  APPROVAL --> LEDGER
  RELEASE --> LEDGER
```

## 11. Published Contracts And ALM Rollup

This shows the enterprise architecture / ALM view where upper layers consume published child contracts instead of live drafts.

```mermaid
flowchart TD
  CHILD1["Child Capability A
  Published Contract v3"]
  CHILD2["Child Capability B
  Published Contract v5"]
  CHILD3["Shared Capability
  Published Contract v2"]

  PARENT["Parent / Collection Capability"]
  ROLLUP["Rollup Summary
  FR / NFR / API / Versions / Risks"]
  ALM["ALM Export Payload"]
  SYSTEMS["Jira / Confluence / GitHub / Other ALM"]

  CHILD1 --> PARENT
  CHILD2 --> PARENT
  CHILD3 -. "shared reference" .-> PARENT

  PARENT --> ROLLUP
  ROLLUP --> ALM
  ALM --> SYSTEMS
```

## 12. One Page Story

If you want one single diagram for an executive or demo overview, use this.

```mermaid
flowchart TD
  COLL["Collection / Enterprise Layer"]
  CAP["Delivery Capability"]
  WF["Workflow Designer"]
  WI["Work Item"]
  WB["Developer Cockpit"]
  EVID["Evidence + Approvals"]
  ALM["Published Contracts + ALM"]

  COLL --> CAP
  CAP --> WF
  WF --> WI
  WI --> WB
  WB --> EVID
  CAP --> ALM
  EVID --> ALM
```

## Suggested Use

- Use diagrams `1-3` for enterprise architecture and onboarding conversations.
- Use diagrams `4-6` for workflow and delivery operating model walkthroughs.
- Use diagrams `7-10` for product demos and developer experience storytelling.
- Use diagrams `11-12` for ALM, governance, and executive-level presentations.
