# Singularity Neo Demo Video Script

This script is designed for a short product walkthrough of Singularity Neo. It is written for a calm, business-first demo that shows the main flow without getting lost in advanced tooling.

## Goal

Show that Singularity Neo helps a team:
- define a capability
- shape how work moves
- collaborate with agents
- run delivery through stages
- keep evidence and audit history

Recommended video length:
- `4 to 6 minutes` for a concise overview
- `7 to 9 minutes` if you want to include more Agents, Chat, and Evidence depth

## Before You Record

Prepare the screen:
- close unrelated tabs and windows
- keep browser zoom at `100%`
- use one clean capability for the whole demo
- keep the app on `http://localhost:3000`
- avoid showing noisy logs or terminal windows unless needed

Prepare the data:
- use one capability with meaningful name and description
- make sure the workflow already exists in Designer
- keep a few agents visible in Agents
- have at least one work item in Work
- have at least one artifact or completed item in Evidence

Recommended recording setup on macOS:
1. Press `Cmd + Shift + 5`
2. Choose `Record Selected Portion`
3. Turn on `Microphone` if you want narration
4. Record the browser only

## Suggested Recording Order

1. `Home`
2. `Designer`
3. `Agents`
4. `Chat`
5. `Work`
6. `Evidence`

This keeps the story natural:
- what the capability is
- how it is designed
- who participates
- how people collaborate
- how work moves
- what was produced

## Short Narration Script

### 1. Opening on Home

What to show:
- active capability
- trust / readiness summary
- next action
- work and evidence summary

What to say:

> This is Singularity Neo.  
> It is a capability-centered operating workspace for enterprise delivery.  
> Instead of treating work, agents, workflows, and evidence as separate tools, Singularity brings them together inside one capability.  
> On Home, a business owner can quickly see what this capability owns, whether it is ready, what needs attention, and what has already been delivered.

Pause on:
- the capability summary
- the readiness or trust section
- the recommended next action

### 2. Move to Designer

What to show:
- full-screen workflow canvas
- lifecycle lanes
- nodes across the flow

What to say:

> Designer is where the operating model is defined.  
> Each capability can have its own lifecycle, and those lifecycle phases become the lanes that drive execution.  
> The workflow is not just a diagram. It is the structure that Work, Evidence, and orchestration follow later in the product.

Optional extra line:

> This makes the capability adaptable. Teams are not forced into one fixed SDLC.

### 3. Move to Agents

What to show:
- owner row
- collaborator list
- learning / readiness summary for one selected agent

What to say:

> Agents shows the collaborators inside this capability, including the owning agent and supporting specialist agents.
> Each agent is scoped to the capability, can learn from its memory and artifacts, and can then be used directly in collaboration.  
> The goal here is clarity: who can help, who is ready, and which agent to bring into the conversation.

Pause on:
- one selected agent
- readiness / learning summary
- `Use in chat`

### 4. Move to Chat

What to show:
- transcript
- active capability and agent
- context inspector if useful

What to say:

> Chat is where collaboration happens with full capability context.  
> Instead of starting from scratch every time, the active agent can use the capability’s learned context, memory, and session history.  
> This makes the conversation resumable and grounded in the actual work of the capability.

Good demo action:
- send one short prompt
- or show an existing conversation that looks clean and intentional

Recommended prompt if you want to type live:

> Summarize the current capability status and tell me the next best action.

### 5. Move to Work

What to show:
- orchestration board
- one active work item
- waits, approvals, or restart/reset controls if available

What to say:

> Work is the business-facing orchestration surface.  
> This is where delivery moves through the lifecycle, where approvals and blockers are handled, and where operators can restart or reset progress when needed.  
> It gives a clear answer to the question: what is moving, what is blocked, and what needs attention right now?

Pause on:
- an active work item
- the right-side control panel
- any approval or blocked state if one exists

### 6. Move to Evidence

What to show:
- artifacts
- completed work
- Flight Recorder

What to say:

> Evidence is where Singularity closes the loop.  
> You can see artifacts, handoffs, completed work, and the Flight Recorder trail that explains how the work moved through the capability.  
> This is especially important in enterprise settings because it creates a durable audit record of decisions, approvals, and outputs.

For Flight Recorder:

> Flight Recorder shows the story of a work item over time, including checkpoints, gates, evidence, and final outcome.

## One-Minute Version

If you want a very short clip:

> Singularity Neo is a capability-centered enterprise workspace.  
> Home shows what matters now.  
> Designer defines the workflow and lifecycle.  
> Agents shows who can help.
> Chat enables grounded collaboration with agents.  
> Work moves delivery through approvals and blockers.  
> Evidence and Flight Recorder show exactly what was produced and why.

## Presentation Tips

- move the cursor slowly and deliberately
- wait half a second before switching screens
- keep scrolling minimal
- do not open advanced tools unless they support the story
- prefer one coherent capability rather than jumping across multiple examples
- if something is still loading, pause narration instead of clicking repeatedly

## Safe Demo Checklist

Before recording, make sure:
- the active capability is the right one
- only the intended capability is visible
- test capabilities are removed
- sensitive repo paths, tokens, or runtime details are not shown
- there is at least one clean work item and one evidence artifact to demonstrate

## Optional Closing Line

> Singularity Neo helps teams move from capability definition to execution and evidence in one connected system, with agents, workflows, orchestration, and auditability all working together.
