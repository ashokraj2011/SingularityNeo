# Spec: Unified Cockpit Timeline (Pillar B)

**Owner:** Engineering · **Target sprint:** 1 sprint (5–8 eng-days)
**Goal:** Deliver the pitch's core promise — *one brain, not many tabs* — by fusing every work-item-scoped event into a single append-only stream consumed by one UI surface.

---

## 1. Problem

Today events live in six sibling tables and are surfaced through separate services and UI zones:

| Table / source | Service | Current UI surface |
|---|---|---|
| `capability_messages` | chatWorkspace | Chat page |
| `capability_run_events` | execution/service | Run detail |
| `capability_tool_invocations` | execution/service | Run detail → Tools tab |
| `capability_run_waits` | execution/service | Wait banner |
| `capability_artifacts` | ledger | Ledger page |
| `capability_approval_decisions` | access / ledger | Approval inbox |

`server/flightRecorder.ts` and `server/interactionFeed.ts` already aggregate subsets of these, but neither produces a *single* ordered stream scoped to a work item with uniform shape, and the UI never renders them in one frame.

**Outcome we want:** a user opens one work item in the Cockpit and sees chat, agent thoughts, tool calls, retrievals, uploads, artifacts, waits, and approvals interleaved in one vertically scrolling stream, with one input bar at the bottom. No tab switches.

---

## 2. Success criteria (acceptance)

1. A single endpoint returns a merged, time-ordered stream for any `workItemId` with stable pagination and live updates.
2. The Orchestrator work-item view renders that stream as the default view; existing "Chat" / "Runs" / "Evidence" tabs either disappear or become filter chips above the same stream.
3. Every new event of any of the six source types appears in the stream within **≤ 2 s** (SSE) of being persisted.
4. An evidence packet generated from the work item (Pillar C) can cite any stream item by a stable `streamId`.
5. No existing page breaks; legacy per-source endpoints remain available for a 1-release deprecation window.

---

## 3. Design

### 3.1 Unified event shape

Normalize all six source tables into one TypeScript discriminated union. **Do not** denormalize into a new physical table — use a database view for reads.

```ts
// src/types/timeline.ts
export type TimelineEventKind =
  | 'MESSAGE'          // capability_messages (chat turn from user or agent)
  | 'AGENT_THOUGHT'    // run event subtype: reasoning / plan
  | 'TOOL_CALL'        // capability_tool_invocations
  | 'RETRIEVAL'        // run event subtype: knowledge lens entry
  | 'WAIT'             // capability_run_waits (pending human input)
  | 'APPROVAL'         // capability_approval_decisions
  | 'ARTIFACT'         // capability_artifacts
  | 'PHASE_CHANGE'     // run event subtype: phase transition
  | 'RUN_LIFECYCLE';   // run event subtype: START, COMPLETE, CANCEL, PAUSE, RESUME, ERROR

export interface TimelineEventBase {
  streamId: string;          // `${source}:${sourceRowId}` — stable, deterministic
  workItemId: string;
  capabilityId: string;
  runId: string | null;      // null for chat that isn't tied to a run
  occurredAt: string;         // ISO-8601, primary sort key
  sequence: number;           // tiebreaker for same-ms events
  kind: TimelineEventKind;
  actor: {
    type: 'USER' | 'AGENT' | 'SYSTEM';
    id: string;
    displayName: string;
    roleProfile?: string;     // e.g. REVIEWER, BUILDER — for role chips
  };
  phaseId: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'SYSTEM';
  correlationId: string | null; // ties agent thought → tool call → artifact
  source: {
    table:
      | 'capability_messages'
      | 'capability_run_events'
      | 'capability_tool_invocations'
      | 'capability_run_waits'
      | 'capability_approval_decisions'
      | 'capability_artifacts';
    rowId: string;
  };
}

export type TimelineEvent =
  | (TimelineEventBase & { kind: 'MESSAGE';        payload: MessagePayload })
  | (TimelineEventBase & { kind: 'AGENT_THOUGHT';  payload: AgentThoughtPayload })
  | (TimelineEventBase & { kind: 'TOOL_CALL';      payload: ToolCallPayload })
  | (TimelineEventBase & { kind: 'RETRIEVAL';      payload: RetrievalPayload })
  | (TimelineEventBase & { kind: 'WAIT';           payload: WaitPayload })
  | (TimelineEventBase & { kind: 'APPROVAL';       payload: ApprovalPayload })
  | (TimelineEventBase & { kind: 'ARTIFACT';       payload: ArtifactPayload })
  | (TimelineEventBase & { kind: 'PHASE_CHANGE';   payload: PhaseChangePayload })
  | (TimelineEventBase & { kind: 'RUN_LIFECYCLE';  payload: RunLifecyclePayload });

// Payload shapes kept lean — richer data fetched on demand via `/timeline/:streamId`
export interface ToolCallPayload {
  tool: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED_BY_POLICY';
  durationMs: number | null;
  policyDecisionId: string | null;
  inputDigest: string;           // sha256 of stringified input
  outputDigest: string | null;
  errorSummary: string | null;
}

// …other payload interfaces follow the same lean-snapshot pattern
```

### 3.2 SQL view — single source of ordered truth

Add `capability_timeline_events` as a **materialized view or a plain view** over the six tables. Plain view is fine to ship; promote to materialized later if read latency demands it.

```sql
-- migration 00NN_create_timeline_view.sql
CREATE OR REPLACE VIEW capability_timeline_events AS
  SELECT
    'capability_messages:' || id::text AS stream_id,
    work_item_id,
    capability_id,
    run_id,
    created_at AS occurred_at,
    COALESCE(sequence_no, 0) AS sequence,
    'MESSAGE'::text AS kind,
    actor_type, actor_id, actor_display_name, actor_role_profile,
    phase_id,
    visibility,
    correlation_id,
    'capability_messages'::text AS source_table,
    id::text AS source_row_id,
    jsonb_build_object(
      'body', body,
      'attachments', attachments,
      'mentions', mentions
    ) AS payload
  FROM capability_messages
  WHERE deleted_at IS NULL

  UNION ALL

  SELECT
    'capability_tool_invocations:' || id::text,
    work_item_id, capability_id, run_id,
    started_at AS occurred_at,
    COALESCE(sequence_no, 0),
    'TOOL_CALL',
    'AGENT', agent_id, agent_display_name, role_profile,
    phase_id, 'PUBLIC', correlation_id,
    'capability_tool_invocations', id::text,
    jsonb_build_object(
      'tool', tool_name,
      'status', status,
      'durationMs', duration_ms,
      'policyDecisionId', policy_decision_id,
      'inputDigest', input_digest,
      'outputDigest', output_digest,
      'errorSummary', error_summary
    )
  FROM capability_tool_invocations

  UNION ALL

  SELECT
    'capability_run_events:' || id::text,
    work_item_id, capability_id, run_id,
    occurred_at,
    COALESCE(sequence_no, 0),
    CASE event_type
      WHEN 'AGENT_THOUGHT'   THEN 'AGENT_THOUGHT'
      WHEN 'RETRIEVAL'       THEN 'RETRIEVAL'
      WHEN 'PHASE_ENTER'     THEN 'PHASE_CHANGE'
      WHEN 'PHASE_EXIT'      THEN 'PHASE_CHANGE'
      ELSE 'RUN_LIFECYCLE'
    END,
    actor_type, actor_id, actor_display_name, actor_role_profile,
    phase_id, visibility, correlation_id,
    'capability_run_events', id::text,
    payload
  FROM capability_run_events

  UNION ALL

  SELECT
    'capability_run_waits:' || id::text,
    work_item_id, capability_id, run_id,
    created_at,
    COALESCE(sequence_no, 0),
    'WAIT',
    'SYSTEM', 'runtime', 'Runtime', NULL,
    phase_id, 'PUBLIC', correlation_id,
    'capability_run_waits', id::text,
    jsonb_build_object(
      'reason', reason,
      'prompt', prompt,
      'expectedResponse', expected_response,
      'status', status
    )
  FROM capability_run_waits

  UNION ALL

  SELECT
    'capability_approval_decisions:' || id::text,
    work_item_id, capability_id, run_id,
    decided_at,
    COALESCE(sequence_no, 0),
    'APPROVAL',
    'USER', approver_id, approver_display_name, NULL,
    phase_id, 'PUBLIC', correlation_id,
    'capability_approval_decisions', id::text,
    jsonb_build_object(
      'decision', decision,
      'note', note,
      'subjectType', subject_type,
      'subjectId', subject_id
    )
  FROM capability_approval_decisions

  UNION ALL

  SELECT
    'capability_artifacts:' || id::text,
    work_item_id, capability_id, run_id,
    created_at,
    COALESCE(sequence_no, 0),
    'ARTIFACT',
    producer_actor_type, producer_actor_id, producer_display_name, producer_role_profile,
    phase_id, visibility, correlation_id,
    'capability_artifacts', id::text,
    jsonb_build_object(
      'artifactType', artifact_type,
      'name', name,
      'contentHash', content_hash,
      'sizeBytes', size_bytes,
      'previewable', previewable
    )
  FROM capability_artifacts
  WHERE deleted_at IS NULL;
```

Indexes required (add on the underlying tables, not the view):

```sql
CREATE INDEX IF NOT EXISTS idx_messages_work_item_time        ON capability_messages          (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tools_work_item_time           ON capability_tool_invocations  (work_item_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_run_events_work_item_time      ON capability_run_events        (work_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_waits_work_item_time           ON capability_run_waits         (work_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_work_item_time       ON capability_approval_decisions (work_item_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_work_item_time       ON capability_artifacts         (work_item_id, created_at DESC);
```

Benchmark after adding: p50 for 500-event work item should be < 60 ms. If not, materialize the view with a trigger-driven refresh.

### 3.3 Backend: one service, one endpoint, one stream

**New module:** `server/timeline/service.ts`

```ts
export interface TimelineQuery {
  workItemId: string;
  before?: string;            // ISO cursor for pagination (older than)
  after?: string;             // ISO cursor for tailing
  limit?: number;             // default 100, max 500
  kinds?: TimelineEventKind[];// optional filter — used by deprecated legacy surfaces
  phaseId?: string;
  actorId?: string;
}

export interface TimelinePage {
  events: TimelineEvent[];
  nextBefore: string | null;  // null when no more older
  nextAfter: string | null;   // null when caller is at head
  serverTime: string;
}

export async function queryTimeline(q: TimelineQuery): Promise<TimelinePage>;
export async function getTimelineEvent(streamId: string): Promise<TimelineEvent | null>;
```

**Query shape** (simplified):

```sql
SELECT * FROM capability_timeline_events
 WHERE work_item_id = $1
   AND ($2::timestamptz IS NULL OR occurred_at < $2)
   AND ($3::timestamptz IS NULL OR occurred_at > $3)
   AND ($4::text[]     IS NULL OR kind = ANY($4))
 ORDER BY occurred_at DESC, sequence DESC
 LIMIT $5;
```

**New REST endpoint:** `GET /api/capabilities/:capabilityId/work-items/:workItemId/timeline`
- Query params: `before`, `after`, `limit`, `kinds` (comma-separated)
- Returns `TimelinePage`
- Access control: reuse `requireCapabilityAccess(req, 'view')`; drop events with `visibility='PRIVATE'` unless actor matches.

**New SSE endpoint:** `GET /api/capabilities/:capabilityId/work-items/:workItemId/timeline/stream`
- Emits `event: timeline` with a `TimelineEvent` payload for every insert across the six source tables.
- Implementation: single `EventEmitter` in-process; each existing writer (chatWorkspace, execution/service, ledger, access) calls `timelineBus.publish(event)` right after DB commit. No polling.
- Heartbeat: `event: ping` every 20 s. Reconnect: client sends `Last-Event-Id` (the streamId) → server backfills missed events via `queryTimeline({ after })`.

**New detail endpoint:** `GET /api/timeline-events/:streamId`
- Returns the full event plus richer fields not in the lean payload (e.g. full tool input/output if caller has permission). Used by lazy expansion in the UI.

**Evidence packet integration:** `evidencePackets.ts` gains a `streamRange` field — `{ firstStreamId, lastStreamId, inclusionPolicy }` — so packets cite exact events, making replay deterministic (supports Pillar C).

### 3.4 Writer integration — one line per writer

Each of the six current writers adds a single call after commit. Example for `chatWorkspace.ts`:

```ts
const row = await insertMessage(tx, input);
await tx.commit();
timelineBus.publish(mapMessageRowToTimelineEvent(row));   // ← new line
```

Do **not** move the writers. We are only fanning out notifications. The view already reads the same tables.

### 3.5 Frontend: one stream, one input

**New component tree** inside `src/pages/Orchestrator.tsx` (or new `src/pages/Cockpit.tsx`):

```
<CockpitWorkItem>
  <WorkItemHeader />                 {/* phase · owner · SLA · readiness meter */}
  <ThreeColumn>
    <LeftRail>
      <PlanPanel />                  {/* DoD, contract, acceptance */}
      <PhaseLane />
      <Stakeholders />
    </LeftRail>

    <TimelineColumn>                 {/* ← the merge */}
      <TimelineFilterChips />        {/* All · Chat · Runs · Tools · Evidence · Approvals */}
      <TimelineStream>
        {events.map(ev => <TimelineItem key={ev.streamId} event={ev} />)}
      </TimelineStream>
      <ComposeBar />                 {/* one input: chat / upload / @agent / /command */}
    </TimelineColumn>

    <RightRail>
      <KnowledgeLens />              {/* latest RETRIEVAL events, grouped */}
      <EvidenceSummary />            {/* latest ARTIFACT events this run */}
      <LearningNotes />              {/* latest AGENT_THOUGHT events flagged as learning */}
    </RightRail>
  </ThreeColumn>
</CockpitWorkItem>
```

**`TimelineItem` dispatches on `event.kind` to a renderer:**

| Kind | Renderer | Interactions |
|---|---|---|
| MESSAGE | Chat bubble with actor avatar + role chip | Reply, quote, pin |
| AGENT_THOUGHT | Collapsed "thinking" card (expand to see reasoning) | Expand, cite |
| TOOL_CALL | Inline card with tool name, status pill, duration; expand → input/output digests + policy chip | Expand, replay (Pillar D+C) |
| RETRIEVAL | Compact chip with source count; click → right rail pinned | Pin to Knowledge Lens |
| WAIT | Yellow banner in-stream with CTA ("Provide input") | Resolve inline |
| APPROVAL | Pinned block with Approve / Reject / Comment | Decide inline |
| ARTIFACT | Preview card (markdown/code/image); click → right rail pinned | Download, link, open packet |
| PHASE_CHANGE | Slim divider: `→ Phase: Build` | — |
| RUN_LIFECYCLE | Divider + status pill: `Run #42 started / completed` | Open run detail drawer |

**One input bar** (`ComposeBar`) supports mode switch via leading character:
- Plain text → chat message
- `/` → slash command menu (`/run`, `/approve`, `/upload`, `/handoff`)
- `@` → agent or user mention picker
- Drag-and-drop file → upload (creates `ARTIFACT` event)

**State management:**
- Use a single `useTimeline(workItemId)` hook backed by a reducer.
- Initial load: `GET /timeline?limit=100` (newest-first), reverse for display.
- Live tail: open SSE; on each event, prepend if newer than `head`; deduplicate by `streamId`.
- Scroll up: fetch older with `before=<oldest.occurredAt>`.
- Filter chips toggle `kinds` client-side first (fast) and, if user scrolls into unfetched range, re-query with `kinds`.

### 3.6 Deprecation of legacy surfaces

- Keep existing `/api/capabilities/:id/chat`, `/api/runs/:runId`, `/api/ledger/...` endpoints for one release.
- Mark them `@deprecated` in JSDoc; add response header `X-Deprecated: unified-timeline`.
- Delete the separate Chat page from nav; add a small "Legacy chat" link in Studio for 1 release, then remove.
- Ledger page becomes a saved filter on the unified stream (`kinds=ARTIFACT,APPROVAL`) — keep the route but render the same component.

### 3.7 Observability

- Metric `timeline.query.latency_ms` histogram per work item
- Metric `timeline.sse.subscribers` gauge
- Metric `timeline.publish.count` counter per `kind`
- Log warning if a writer commits a row that doesn't appear in the stream within 2 s (drift detector — compares `NOW()` to `timeline.events.max(occurred_at)` for that workItem)

---

## 4. Work breakdown

### PR 1 — Data plane (2 days)
- Migration: indexes + `capability_timeline_events` view
- `server/timeline/service.ts` with `queryTimeline`, `getTimelineEvent`
- Unit tests for query filters, ordering, pagination, access control
- Benchmark fixture: 10k events → assert < 100 ms p95

### PR 2 — REST + SSE endpoints (1 day)
- `GET /api/capabilities/:c/work-items/:w/timeline`
- `GET /api/capabilities/:c/work-items/:w/timeline/stream` (SSE + backfill)
- `GET /api/timeline-events/:streamId`
- In-process `timelineBus` event emitter
- Writer integrations: one `publish(...)` call in each of the six writers

### PR 3 — Frontend Cockpit shell (2 days)
- `useTimeline` hook (initial load + SSE + pagination + dedupe)
- `TimelineStream` virtualized list (react-window)
- Eight renderers for the eight kinds
- `ComposeBar` with mode switching
- Filter chips

### PR 4 — Wire into Orchestrator (1 day)
- Mount in current Orchestrator work-item view as default inner tab
- Retain "Runs" and "Ledger" as filter chips above the same stream
- Remove top-level Chat nav; add legacy route

### PR 5 — Observability + cleanup (1 day)
- Metrics, drift detector
- Deprecation headers on legacy endpoints
- Docs update (`README.md`, `docs/capability-mermaid-diagrams.md`)

### PR 6 — Evidence packet integration (0.5 day, can overlap)
- Add `streamRange` to packet builder
- Link timeline items to packet via `streamId` anchor

---

## 5. Test plan

**Unit**
- View returns correctly ordered events across six source tables
- Pagination: `before` returns strictly older, `after` returns strictly newer, no duplicates across pages
- Access control: `PRIVATE` events filtered for unauthorized actors
- `mapXRowToTimelineEvent` functions round-trip shape

**Integration**
- Writer → publish → SSE subscriber receives event within 200 ms
- Reconnect with `Last-Event-Id` backfills correctly
- Filter chips preserve ordering with mixed kinds
- Legacy endpoints still return same payload (regression)

**E2E (Playwright, `tests/`)**
- Open work item → see prior events loaded
- Post chat message → appears in stream + persists after reload
- Trigger run → see PHASE_CHANGE, TOOL_CALL, ARTIFACT, APPROVAL appear live
- Approve inline → next page load shows APPROVAL event in stream
- Upload file via ComposeBar → ARTIFACT event appears with preview

**Load**
- 500 concurrent SSE subscribers per work item: p95 publish-to-receive < 500 ms
- 10k-event work item: initial page load p95 < 300 ms

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| View query slow at scale | Per-source indexes on `(work_item_id, occurred_at)`; promote to materialized view with trigger refresh if p95 > 150 ms |
| SSE at scale (many subscribers) | In-process emitter is fine up to ~1k subscribers per node; add Redis pub/sub later if horizontal scaling requires it |
| Writer forgets to call `publish()` | Drift detector metric alerts on DB→stream divergence; also a linter rule requiring `publish(` after commit for the six tables |
| UI regressions in Chat / Ledger users | Keep legacy routes + one-release deprecation window; feature flag `cockpit.unifiedTimeline` for gradual rollout |
| Correlation across kinds breaks stories | `correlation_id` already exists on most source tables — require new writes to populate it; backfill script for existing rows maps by `(run_id, phase_id, window)` |
| Payload divergence between view and detail endpoint | Contract test: `queryTimeline` + `getTimelineEvent` for same row produces overlapping fields with identical values |

---

## 7. Rollout

1. Ship behind feature flag `cockpit.unifiedTimeline` (default off in prod, on in dev)
2. Enable for internal capability first (the team's own delivery capability — dogfood for 3 days)
3. Open-beta to 1–2 design-partner accounts; compare metrics: `timeline.query.latency_ms`, session length, tab switches per session (expect tab switches ↓ sharply)
4. Remove flag after 2 clean releases; delete legacy Chat and Ledger route components

---

## 8. Out of scope (explicit non-goals)

- Cross-work-item / cross-capability timeline (handled later by global search, Gap #10)
- Real-time collaborative editing of artifacts (separate spec)
- Threaded @mentions (depends on Gap #6 — will reuse this stream once implemented)
- New permission model (reuses existing `requireCapabilityAccess`)

---

## 9. Definition of done

- All 6 writers publish to the bus
- View + endpoints + SSE shipped with the listed metrics green
- Cockpit renders the stream as the default work-item view
- Legacy Chat nav removed; Ledger route now a filter on same stream
- Feature flag removed
- Docs updated
- Dogfooded for ≥ 3 days by the engineering team on their own capability
- p95 load latency < 300 ms, p95 publish-to-SSE < 500 ms

---

## 10. Post-ship quick wins (1 week after merge)

- **Pillar D** hooks naturally: `TOOL_CALL` renderer reads `event.payload.policyDecisionId` and shows a role-chip. Shipping this completes the "provable differentiation" UI moment.
- **Pillar C** (Evidence Packet): "Generate packet from this run" now just slices the stream by `runId`. One extra button.
- **Gap #6** (comments + mentions): each comment becomes a `MESSAGE` with `payload.mentions`; mention notification fires through Gap #1 dispatcher once built.

All three stack cleanly on top of the unified timeline — which is the reason to build it first.
