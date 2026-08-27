# Project, Team, and Skill Integration Plan

> Historical design only. The current project contract is defined by
> `project-data-layout.md` and the implemented project workspace. Team runs and
> collaborative tasks are out of the current scope. Durable generated files are
> project assets; there is no separate deliverable concept or directory. Each
> project task is one root Project Coordinator session; its Worker/SubAgent
> sessions are the only task breakdown. The former goal/compiler/DAG scheduler
> design is retired.

## Background

Moss currently uses sessions as the primary desktop entry point. This should stay true: a user should still be able to open Moss and start a normal conversation without creating or selecting a project.

Projects should be introduced as an optional long-lived workspace for complex work. A project owns durable context, assets, tasks, experts, skills, connectors, automations, and team run history. A team is not the project itself; a team is a temporary execution group inside a project or session.

The WorkBuddy reference suggests a useful project model:

- Project tabs: Activity, Plan, Tasks, Assets.
- Project configuration: Instructions, Connectors, Experts, Skills, Automation.
- Composer hint: reference assets, project tasks, and skills from the input.

Moss should adopt this information architecture while preserving the existing "create session first" workflow.

## Product Principles

1. Projects are optional.
   Users can keep using plain sessions. A project is added when they need persistent context, task organization, assets, or multi-agent collaboration.

2. Team is an execution mode, not a long-term container.
   A project can have many team runs. Each run may create teammates, execute tasks, produce deliverables, and then close.

3. Skills are first-class skills.
   The "技能" section in project creation must map to Moss/Codex Skill definitions, not connectors or prompts.

4. Memory is structured, not full transcript sharing.
   Team members should share project instructions, assets, task states, and run summaries. They should not all inherit the complete main session transcript by default.

5. Delivery is leader-owned.
   Teammates produce task results; the session leader summarizes and delivers final output to the user.

## Terminology

- Project: Long-lived workspace for a product, feature, research effort, or delivery stream.
- Session: A chat/execution thread. It may be unbound or bound to a project.
- Task: A structured work item. It can belong to a session, project, or team run.
- Team Run: A temporary multi-agent execution under a session/project.
- Expert: An agent template, such as "feedback analyst", "UX researcher", or "prototype engineer".
- Skill: A reusable capability loaded through the Skill tool/system, such as "Deep Research" or "Tencent Meeting".
- Connector: External service integration, such as TAPD, Tencent Docs, GitHub, CNB, database, browser, etc.
- Asset: Durable project material, such as PRDs, design files, meeting notes, test reports, documents, links, and generated deliverables.
- Automation: A trigger or scheduled workflow, such as cron, file watcher, issue watcher, or release checklist.

## New Project Creation UX

The new project dialog should follow the reference form:

```text
新建项目

项目名称
[项目]

指令
[large textarea]

连接器（可选）
+ 添加
TAPD
腾讯文档

专家（可选）
+ 添加
反馈综合分析师
用户体验研究员
快速原型工程师

技能（可选）
+ 添加
腾讯会议
Deep Research

切换模版会覆盖当前编辑内容
```

### Fields

- Project name
  Required. Used for display and project directory/database identity.

- Instructions
  Long text. Stored as project instructions and injected into project-bound sessions as project context.

- Connectors
  Optional external integrations. These should resolve to connector records and credentials/policies, not free-form prompt text.

- Experts
  Optional agent templates available inside this project. Experts can later be used as team members.

- Skills
  Optional Skill IDs. These should be loaded as skills and made available through the existing Skill mechanism.

- Template
  Optional project template. Switching templates can replace name suggestion, instructions, selected connectors, experts, and skills, with a destructive-change confirmation if the form is dirty.

## Project Templates

Project templates are an extension point, not a required built-in business preset.
The supplied "产品需求全流程" content is a reference demo for validating the form shape:

- Name suggestion: 产品需求全流程
- Instructions: the full six-stage product workflow prompt
- Default connectors: TAPD, 腾讯文档
- Default experts:
  - 反馈综合分析师
  - 用户体验研究员
  - 快速原型工程师
- Default skills:
  - 腾讯会议
  - Deep Research

Important distinction:

- TAPD and 腾讯文档 are connectors.
- 反馈综合分析师 and 用户体验研究员 are experts.
- 腾讯会议 and Deep Research are skills.

Do not hard-code this demo template into the desktop client. The first implementation
should expose a `project:list-templates` API that may return an empty list. Later,
templates can be loaded from files, plugins, workspace policy, or a team marketplace.

## Information Architecture

### App Level

The app keeps the existing session-first layout.

Add a Projects entry to the left navigation:

```text
Sessions
Projects
Apps
Cron
Settings
```

Do not force project selection on startup.

### Project Page

When a project is opened, show:

```text
Project / {name}

Activity | Plan | Tasks | Assets | Sessions | Team Runs

Right side: Project Configuration
  Instructions
  Connectors
  Experts
  Skills
  Automation
```

### Project Tabs

- Activity
  Timeline of sessions, task changes, team run events, asset changes, and deliverables.

- Plan
  Project goals, milestones, phases, risks, open questions, and decisions.

- Tasks
  Project-level task list. Tasks can be assigned to humans, experts, sessions, or team members.

- Assets
  File and document library. Includes uploaded files, generated docs, meeting notes, PRDs, test cases, and reports.

- Sessions
  All sessions bound to the project.

- Team Runs
  Current and historical team executions, with members, task results, status, and final summaries.

## Session Integration

Existing behavior remains:

- New Session creates a normal unbound session.
- A session may later be bound to a project.
- A new project can start with zero sessions.
- A project session should display a project badge near the session title.

Session composer supports references:

```text
@asset
@task
@expert
@skill
@member
```

These references must resolve to structured payloads instead of raw prompt concatenation.

## Team Integration

### Team Creation

Inside a project-bound session, the user can create a team run.

Team creation should support planned members:

```ts
type PlannedTeamMember = {
  name: string
  expertId?: string
  role: string
  subagentType?: string
  model?: string
  mode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'
  autoStart?: boolean
}
```

TeamCreate should create:

- Team run metadata.
- Team task scope.
- Planned member roster.
- Team run memory directory.
- Optional started teammates for members with `autoStart`.

### Member States

```text
planned
starting
running
idle
blocked
completed
failed
stopped
```

### Team Run UX

Right panel in a project session:

```text
Overview | Tasks | Team | Files | Browser | Changes
```

Team view:

```text
Team Run: 产品需求评审准备
4 members · 2 running · 1 idle · 1 planned

architect    running   #1 #2
frontend     planned   -
tester       idle      #5

[Add member] [Start planned] [Summarize run] [Close team]
```

### Assignment

Task assignment is done through structured task updates:

- Assign task owner to expert/member.
- Set dependencies with `blockedBy`.
- Notify owner through team message when needed.

The UI should not depend on injecting text like "please create a task". It should call task APIs directly.

## Memory Model

Use layered memory:

```text
Project Memory
  Long-term goals, constraints, business rules, decisions.

Run Memory
  Current team run plan, status, open risks, member summaries.

Task Memory
  Per-task context, result, files changed, validation, follow-ups.

Member Context
  Private teammate transcript and short-term state.
```

Do not share full transcripts between all members by default.

Recommended file layout:

```text
~/.moss/projects/{projectId}/project.json
~/.moss/projects/{projectId}/memory/project.md
~/.moss/projects/{projectId}/memory/decisions.md
~/.moss/projects/{projectId}/memory/open-questions.md
~/.moss/projects/{projectId}/assets/
~/.moss/projects/{projectId}/sessions/{sessionId}.json
~/.moss/projects/{projectId}/runtime/runs/{runId}/run.json
~/.moss/projects/{projectId}/runtime/runs/{runId}/summary.md
~/.moss/projects/{projectId}/runtime/runs/{runId}/tasks/{taskId}/result.md
~/.moss/projects/{projectId}/deliverables/
```

Task list storage can continue to use the existing file-backed task system:

```text
~/.moss/tasks/project-{projectId}/
~/.moss/tasks/project-{projectId}__session-{sessionId}/
~/.moss/tasks/project-{projectId}__team-{teamRunId}/
```

## Data Model

### Project

```ts
type Project = {
  id: string
  name: string
  instructions: string
  templateId?: string | null
  connectorIds: string[]
  expertIds: string[]
  skillIds: string[]
  createdAt: number
  updatedAt: number
  archivedAt?: number | null
}
```

### Connector

```ts
type ProjectConnector = {
  id: string
  provider: 'tapd' | 'tencent-docs' | 'github' | 'cnb' | string
  displayName: string
  configRef?: string
  enabled: boolean
}
```

### Expert

```ts
type ProjectExpert = {
  id: string
  name: string
  description: string
  agentType: string
  systemPrompt?: string
  defaultModel?: string
  defaultMode?: string
  skillIds?: string[]
}
```

### Skill Reference

```ts
type ProjectSkillRef = {
  id: string
  name: string
  source: 'builtin' | 'project' | 'user' | 'plugin'
  enabled: boolean
}
```

### Team Run

```ts
type TeamRun = {
  id: string
  projectId?: string | null
  sessionId: string
  name: string
  description?: string
  status: 'draft' | 'running' | 'completed' | 'failed' | 'closed'
  taskListId: string
  plannedMembers: PlannedTeamMember[]
  activeMembers: TeamMemberRuntime[]
  createdAt: number
  updatedAt: number
  closedAt?: number | null
}
```

## Backend Plan

### Session-Scoped Flags

Do not enable project/team behavior through process-global environment variables in desktop mode.

Add session-scoped options:

```ts
type ClaudeSessionOptions = {
  projectId?: string
  projectContext?: ProjectContext
  agentTeamsEnabled?: boolean
  taskScope?: TaskScope
}
```

`isAgentSwarmsEnabled()` should prefer a session-scoped value when available, then fall back to CLI env/argv for existing CLI behavior.

### Project Services

Add a project service in the desktop main process:

```text
project:list
project:get
project:create
project:update
project:archive
project:list-assets
project:add-asset
project:remove-asset
project:list-sessions
project:bind-session
project:unbind-session
```

### Task Services

Add structured task IPC:

```text
project:list-tasks
project:create-task
project:update-task
project:get-task
```

These should use existing task utilities and project/team task scopes.

### Team Services

Add structured team IPC:

```text
project:create-team-run
project:get-team-run
project:list-team-runs
project:start-team-member
project:send-team-message
project:shutdown-team-member
project:close-team-run
```

First implementation can wrap existing TeamCreate, Agent spawn, SendMessage, and TaskUpdate behavior, but should expose stable project-oriented APIs to the UI.

### Skill Services

Add skill discovery for project creation:

```text
skill:list
skill:get
project:add-skill
project:remove-skill
```

The project stores selected `skillIds`. Project-bound sessions receive those skill IDs as available context and the Skill tool remains the execution mechanism.

## Frontend Plan

### New Components

```text
components/projects/project-list.tsx
components/projects/new-project-dialog.tsx
components/projects/project-page.tsx
components/projects/project-config-panel.tsx
components/projects/project-assets-tab.tsx
components/projects/project-tasks-tab.tsx
components/projects/project-team-runs-tab.tsx
components/projects/team-run-panel.tsx
components/projects/skill-picker.tsx
components/projects/expert-picker.tsx
components/projects/connector-picker.tsx
```

### New Project Dialog Details

- Use a large textarea for instructions.
- Show character count, e.g. `2/150` for project name and a larger counter for instructions.
- Add template selector with confirmation:
  `切换模版会覆盖当前编辑内容`.
- Separate optional sections:
  - Connectors
  - Experts
  - Skills
- Each section uses add/remove chips and a picker.

### Project Configuration Panel

Use the WorkBuddy right panel pattern:

```text
项目配置

指令
连接器
专家
技能
自动化
```

Each card opens an editor/drawer.

### Team Run Panel

In session right panel:

- Show current team run summary.
- Show member roster.
- Show task ownership.
- Provide actions:
  - Create team
  - Add planned member
  - Start member
  - Send message
  - Assign task
  - Summarize run
  - Close team

### Composer References

Support project references:

```text
@asset
@task
@expert
@skill
@member
```

References should be added to a structured attachment list, not appended as raw text.

## Delivery Model

Teammates should write task-level outputs:

```text
task result
files changed
validation result
risks
follow-up tasks
```

Leader produces final delivery:

```text
what changed
where it changed
test result
remaining risks
next steps
```

The UI should make this explicit with a "Summarize run" action that generates a team run summary and saves it to project deliverables.

## Migration Strategy

Phase 1: Project shell

- Add project table/file store.
- Add project list and new project dialog.
- Store name, instructions, connector IDs, expert IDs, skill IDs.
- Allow creating sessions inside or outside a project.

Phase 2: Project task and asset integration

- Add project-level task scope.
- Add assets tab with upload/list/delete.
- Allow `@asset` and `@task` references in project sessions.

Phase 3: Team run integration

- Add team run model.
- Add planned members.
- Add team run UI in session right panel.
- Start planned members through structured APIs.
- Track member status and task ownership.

Phase 4: Project memory and delivery

- Add project memory files.
- Add run summary and task result outputs.
- Add "Summarize run" and "Save as deliverable".
- Inject project memory into project-bound sessions.

Phase 5: Connectors, experts, and skills depth

- Add connector-specific auth/config.
- Add expert template management.
- Add skill picker and project skill availability.
- Add automation triggers.

## Acceptance Criteria

- Users can still create a normal session without selecting a project.
- Users can create a project with name, instructions, connectors, experts, and skills.
- Skills are stored and displayed as skills, separate from connectors.
- A project can have assets, tasks, sessions, and team runs.
- A project-bound session can start a team run.
- A team run can define planned members before starting them.
- Members can be started, messaged, stopped, and assigned tasks.
- Task progress is visible in the project and session right panel.
- Team member transcripts do not flood the main session transcript.
- Final deliverables are saved under the project.
- Desktop multi-session operation does not depend on process-global team env vars.

## Testing Plan

### Unit Tests

- Project create/update/archive serialization.
- Template application and dirty-form overwrite confirmation.
- Task scope mapping:
  - session
  - project
  - project session
  - project team run
- Skill reference persistence.
- Planned member to active member transitions.

### Integration Tests

- Create project from Product Workflow template.
- Create project-bound session.
- Create project tasks.
- Create team run with planned experts.
- Start one member.
- Assign task to member.
- Verify task status updates.
- Save run summary as deliverable.

### UI Tests

- New project dialog layout on desktop and narrow widths.
- Project config panel sections.
- Skill picker shows skills separately from connectors.
- Team run panel states:
  - no team
  - planned members only
  - running members
  - idle members
  - closed run

### Regression Tests

- Existing session creation still works with no project.
- Existing right-side TaskPanel still shows session tasks.
- Existing coordinator mode still works.
- Existing local/remote agent modes still work.
- Existing cron/settings/apps views are not affected.

## Open Questions

- Should project data be stored in SQLite, files under `~/.moss/projects`, or both?
- Should project-level tasks be visible in every project session by default, or only when explicitly selected?
- Should experts be global templates with project-level selection, or fully project-local definitions?
- Should project skills only affect recommendations, or should they restrict available Skill tool choices?
- Should team run summaries be generated automatically on close, or only when the user clicks "Summarize run"?
