# External Research — Tracker Task Dispatch

Reference implementation: [vibeyard](https://github.com/elirantutia/vibeyard) ("The IDE built for AI coding agents"), kanban board → one-click agent dispatch feature.

## Feature as described (README)

> Kanban task board — plan work on a per-project board with drag-and-drop, search, and tag
> filtering; each card can spawn or resume a CLI session in one click, and tasks auto-move to
> Done when their session completes.

## Data model (`src/shared/types.ts`)

```ts
interface BoardTask {
  id: string;
  title: string;
  prompt: string;        // the dispatch text — first-class field, not derived from title/notes
  notes?: string;
  columnId: string;
  order: number;
  sessionId?: string;      // set while a live session is running this task
  cliSessionId?: string;   // survives session teardown, enables resume
  providerId?: ProviderId;
  profileId?: string;
  planMode?: boolean;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

interface BoardColumn {
  id: string;
  title: string;
  order: number;
  behavior: ColumnBehavior;  // e.g. 'active' | 'terminal' — drives auto-move, not a hardcoded column id
  color?: string;
  locked?: boolean;
}
```

Key choice: columns carry a `behavior` enum, not just a name — the "active" and "done" columns are
resolved by behavior (`getColumnByBehavior('active')` / `getColumnByBehavior('terminal')`), so a
user can rename/reorder columns without breaking the automation.

## Dispatch mechanism (`src/renderer/components/board/board-card.ts`)

Each card renders a single run button whose icon/tooltip is state-dependent:
- `▶` run — no session, no prior cliSessionId
- `↻` resume — no live session, but a `cliSessionId` from a previous run exists
- `>>>` focus — a session is currently live for this task

```ts
export async function runTask(task: BoardTask): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  if (task.sessionId) { focusTaskSession(task); return; }  // 1. already running -> focus

  let resumed = false;
  if (task.cliSessionId) {                                  // 2. try resume by CLI session id
    const existingSession = project.sessions.find(s => s.cliSessionId === task.cliSessionId);
    if (existingSession) {
      appState.setActiveSession(project.id, existingSession.id);
      updateTask(task.id, { sessionId: existingSession.id });
      resumed = true;
    } else {
      const archived = project.sessionHistory?.find(a => a.cliSessionId === task.cliSessionId);
      if (archived) {
        const session = await appState.resumeFromHistorySafe(project.id, archived.id);
        if (session) { updateTask(task.id, { sessionId: session.id }); resumed = true; }
      }
    }
  }

  if (!resumed) {                                            // 3. fresh spawn
    if (!task.prompt.trim()) { showTaskModal('edit', task); return; }  // guard: no prompt -> force edit
    const sessionName = task.title || task.prompt.slice(0, 40);
    const session = task.planMode
      ? appState.addPlanSession(project.id, sessionName, true, task.providerId, task.profileId)
      : appState.addSession(project.id, sessionName, undefined, task.providerId, task.profileId);
    if (session) {
      updateTask(task.id, { sessionId: session.id });
      const activeCol = getColumnByBehavior('active');
      if (activeCol && task.columnId !== activeCol.id) moveTask(task.id, activeCol.id, 0);
      if (task.prompt.trim()) setPendingPrompt(session.id, task.prompt);
    }
  }
}
```

`setPendingPrompt` (`terminal-pane.ts`) stashes the prompt string on the terminal instance;
the terminal spawn path reads it and passes it as the CLI's startup argument/first message once
the PTY is ready — the prompt isn't typed into a live terminal, it's a spawn-time parameter.

## Auto-move-to-Done (`src/renderer/board-session-sync.ts`)

A separate module (not the card) owns the task↔session lifecycle sync — decoupled from the click handler:

```ts
function moveTaskToDone(task: BoardTask): void {
  const doneCol = getColumnByBehavior('terminal');
  if (doneCol && task.columnId !== doneCol.id) moveTask(task.id, doneCol.id, 0);
}

export function initBoardSessionSync(): void {
  onStatusChange((sessionId, status) => {           // session activity/status watcher
    if (status !== 'completed') return;
    const task = getTaskBySessionId(sessionId);
    if (task) moveTaskToDone(task);
  });

  appState.on('session-removed', (data) => {          // session closed manually
    const task = getTaskBySessionId(data.sessionId);
    if (!task) return;
    moveTaskToDone(task);
    updateTask(task.id, { sessionId: undefined });     // clear live link but keep cliSessionId for resume
  });

  appState.on('session-changed', () => {               // persist cliSessionId onto the task once assigned
    for (const task of project.board.tasks) {
      if (!task.sessionId) continue;
      const session = project.sessions.find(s => s.id === task.sessionId);
      if (session?.cliSessionId && task.cliSessionId !== session.cliSessionId) {
        updateTask(task.id, { cliSessionId: session.cliSessionId });
      }
    }
  });
}
```

## Takeaways for nimbalyst's port

1. **`prompt` is a first-class field on the task**, edited via the task modal, separate from
   title/notes. Dispatch sends exactly that string, not a synthesized description.
2. **Three-state button, one control.** No separate "dispatch" vs "resume" button — one button
   whose affordance changes with task state (fresh / resumable / live) is simpler than the
   alternative of a dispatch action plus a separate open/focus action.
3. **Column transitions are behavior-driven, not ID-driven** — resolve "the active column" / "the
   done column" by a semantic tag on the column, so custom column layouts don't break automation.
4. **Auto-move-to-done is decoupled from the click handler** — a session-status listener owns it,
   not the dispatch code path, so it also fires for sessions resumed or focused by other means.
5. **Resume-by-`cliSessionId` is a distinct path from "spawn fresh."** A task remembers its last
   CLI session id even after the live session object is gone (closed tab, app restart), so a
   second click on a finished task's card resumes the same conversation rather than starting over.
6. **Guard on empty prompt**: clicking dispatch with no prompt text opens the edit modal instead of
   spawning an empty session.

## Source

- Repo: https://github.com/elirantutia/vibeyard (MIT license)
- Files read: `README.md`, `src/shared/types.ts`, `src/renderer/components/board/board-card.ts`,
  `src/renderer/board-session-sync.ts`, `src/renderer/state/session-factory.ts`,
  `src/renderer/components/terminal-pane.ts` (excerpt), `src/renderer/components/kanban/pane.ts`,
  `src/renderer/components/kanban/instance.ts`
