# Operating rules for this project

## Every session starts the same way
1. Read CLAUDE.md, docs/PROGRESS.md, and docs/DECISIONS.md. Read only the sections of docs/DESIGN.md relevant to the current phase.
2. Find the current phase and the first unchecked item in docs/PROGRESS.md.
3. Continue from exactly there. Do not re-plan, re-brainstorm, or redesign finished work.

## Write it down, then move on
- After completing any checklist item (design or code): update docs/PROGRESS.md, make sure `npm run build` passes, and commit with a clear message. Only then start the next item.
- The repo is your memory. Anything not written to a file is lost when the session ends.
- The main branch must always build and run.

## Decisions are locked
- docs/DECISIONS.md is a numbered log. Once written, a decision stands.
- Reverse a decision only if it is a real blocker, and append a new entry explaining why. Never silently change direction.
- When a choice comes up, decide quickly, record it in one or two lines, and continue. A good decision now beats a perfect decision later.

## Two-strike rule
- If an approach fails twice (a bug you can't fix, an effect that won't work, performance you can't hit), stop. Switch to the simpler fallback or cut it, log it in DECISIONS.md, and move on. No third attempt at the same approach in the same phase.

## Scope discipline
- One phase per session. When the phase's "Done when" list is complete, write the handoff note and STOP. Do not start the next phase.
- New ideas go in docs/IDEAS.md (parking lot). Do not implement them unless the current phase says to.
- If a phase is dragging, finish the must-have items, mark the rest "deferred" in PROGRESS.md with a one-line reason, and wrap up.
- Be token-efficient: don't print huge files or logs, don't reread files you just wrote, don't leave long-running processes open.

## Handoff note (end of every session)
Append to the Session Log in docs/PROGRESS.md: what was completed, what is broken or deferred, and the exact next step.

## Creative authority
You have full creative freedom within docs/DESIGN.md. Aim for technical impressiveness and emotional impact in a game that is about 5 minutes long.
