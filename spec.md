# Mephisto — Specification (spec.md)

> WHAT to build. Claude: treat every "must" as a hard requirement. Numbers are exact.

## 1. Overview

**Mephisto** is a Kanban board where a logged-in team manages tasks across four stages: **Backlog → In Progress → Review → Done**. Dirty seed data is imported and cleaned by the backend, stored in Supabase, and served to a drag-and-drop board with a dashboard, in-app notifications, and real-time updates.

## 2. Users & roles

- Auth required for everything except the login/signup pages and the login/signup APIs.
- Roles: **admin**, **manager**, **member**. Public signup **always** creates a **member** (role is never chosen by the user); manager/admin are seeded or granted out-of-band.
- **Permission matrix (server-enforced):**

| Action                            | member | manager | admin |
| --------------------------------- | :----: | :-----: | :---: |
| View board / dashboard / comments |   ✅   |   ✅    |  ✅   |
| Add comments                      |   ✅   |   ✅    |  ✅   |
| Drag to change status / reorder   |   ✅   |   ✅    |  ✅   |
| Move a task **into** Done         | ❌ 403 |   ✅    |  ✅   |
| Move a task **out of** Done       | ❌ 403 |   ✅    |  ✅   |
| Create task                       | ❌ 403 |   ✅    |  ✅   |
| Edit task                         | ❌ 403 |   ✅    |  ✅   |
| Delete task                       | ❌ 403 |   ✅    |  ✅   |

- A **member cannot bypass** any rule via the API or UI. Status/column changes happen **only** through `/api/tasks/move` (never through the edit form).

## 3. Data model (Supabase, RLS off)

- **users**: id (uuid), name, email (unique), password_hash, role (default member), avatar, created_at
- **tasks**: id (text, from source), title, description, status, assignee, priority (low/med/high), labels (text[]), due_date, estimate_hours (int), completed_date, position (int, order in column), has_warning (bool), created_by, created_at, updated_at
- **comments**: id, task_id, user_id, text, created_at
- **activity_log**: id, task_id, user_id, action, from_status, to_status, created_at
  - `action` ∈ `created | moved | completed | reordered | assigned | unassigned | deleted | imported | reset`. For **assigned/unassigned**, `to_status` holds the new assignee name (and `from_status` the old one).

## 4. Data import & cleaning (backend — `POST /api/import`)

Reads dirty `tasks.json` (40 records), cleans it, wipes + inserts into Supabase, returns `{ issuesFixed, tasksLoaded }`. Handle ALL:

- **Duplicate IDs** — keep the record appearing **later** in the file; discard earlier. (each removed dup counts as fixed)
- **Three date formats** must all parse: `2026-06-10`, `10/06/2026` (DD/MM/YYYY), `June 5, 2026`.
- **Broken assignees** — `null`, `""`, `"N/A"`, `"n/a"` → **"Unassigned"** (counts as fixed).
- **Bad estimates** — numeric string like `"8"` is **valid, NOT a repair**; negative or non-numeric → **0** (counts as fixed).
- **Invalid statuses** — anything outside the four → **Backlog** + `has_warning = true` (counts as fixed). Known statuses in the wrong case are normalized silently (not counted).
- With the provided seed the exact result is **`13 issues fixed · 37 tasks loaded`**. Header shows a **Data Health badge** with EXACT text: `"N issues fixed · M tasks loaded"`.
- `lib/clean.ts` is a **pure function** and must be unit-tested against these numbers (`npm run test:clean`).

## 5. Functional requirements

### Auth

- **Signup** (name, email, password) → hashed password stored, role forced to **member**, JWT cookie issued.
- **Login** → verify → issue signed JWT in an httpOnly cookie (`token`, 2h, `jose`).
- **Logout** → clear cookie.
- **Middleware** protects `/api/tasks*`, `/api/import`, `/api/board*`, `/api/comments`, `/api/stats`, `/api/activity`, `/api/users`, `/api/stream`, and the board/dashboard pages → 401 (API) / redirect (pages) when no/invalid token.

### Board

- Four columns with **drag & drop** to move cards; visual drop indicator while dragging; same-column drop **reorders**. Empty columns must accept drops correctly (pointer-based collision).
- **WIP limits (server-enforced):** In Progress max **5**, Review max **3**. Exceeding → API returns **409**; UI returns the card to its place with a **shake/toast**. Enforced on **both** move and create.
- **Column headers** show card **count** and **total estimate hours**. **Done** also shows **hours completed this week** (Mon–Sun from `completed_date`; compute week boundaries in code).
- Cards show: title, assignee (+avatar), priority badge, labels, due date (overdue in red), estimate hours, ⚠ if `has_warning`.
- For a **member**, the **Done** column is locked (🔒): incoming cross-column drop is blocked (red indicator + toast) and Done cards are drag-disabled.

### Tasks

- **Create / Edit / Delete** task via a modal form — **manager/admin only** (member gets no buttons; API returns 403).
- The **edit form is content-only** (title, description, assignee, priority, labels, due_date, estimate_hours). **Status is NOT editable via edit** — it is a read-only pill ("drag the card to move"). This prevents WIP/role bypass.
- **Create** lets you pick a starting column; the server enforces WIP + the Done role rule on create too.
- **Assignee** is a **dropdown** populated from the real team (`GET /api/users`) plus any names already on tasks, and "Unassigned".
- **Task detail** view: description, assignee, dates, priority, labels, comments.
- **Comments**: add & list per task (all roles).

### Filters (client-side hide only)

- Assignee **multi-select** (from cleaned data), **title search** with **300ms debounce**, **"Overdue only"** toggle (due date passed AND status ≠ Done). Combine with **AND**.
- **Rule:** filters only hide cards visually — **WIP limits, counts and hour totals always use the full dataset**, never the filtered view.

### Undo / Redo

- Every move/reorder undoable with **Ctrl+Z**, redoable with **Ctrl+Shift+Z**, **≥10 steps**; undo restores exact order and syncs to backend (replays the inverse move through `/api/tasks/move`).

### Notifications

- Every mutation writes to `activity_log` (see §3), including **assignment changes** (assigned / unassigned) on create and edit.
- A **notification bell** in the top bar shows recent activity with an unread badge. New events by **other** users raise a toast; when a task is **assigned to the current user**, a highlighted toast fires and the row is marked "· you". (Own actions and reorders are not toasted.)

### Dashboard & activity

- **Analytics** (`GET /api/stats`): tasks per status, hours per assignee, completed this week → charts (recharts).
- **Activity feed** (`GET /api/activity`): recent actions (who moved/created/completed/assigned what) from `activity_log`.

### Persistence, reset & real-time

- Board state lives in **Supabase** — survives refresh and re-login. **Reset board** (`POST /api/board/reset`) restores the original imported data.
- **Real-time updates:** the board and notifications update live across users. If `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set (and `realtime.sql` run), use **Supabase Realtime** (instant); otherwise fall back to **5s polling**. A refetch mid-drag is skipped so a card is never yanked from the user.

## 6. API surface (contract)

| Method       | Endpoint         | Auth | Purpose                                    |
| ------------ | ---------------- | ---- | ------------------------------------------ |
| POST         | /api/auth/signup | no   | create user (always member)                |
| POST         | /api/auth/login  | no   | verify → JWT cookie                        |
| POST         | /api/auth/logout | yes  | clear cookie                               |
| POST         | /api/import      | yes  | clean + insert dirty data → counts         |
| GET          | /api/tasks       | yes  | list tasks                                 |
| POST         | /api/tasks       | yes  | create task (manager/admin; WIP+role)      |
| PATCH/DELETE | /api/tasks/[id]  | yes  | edit (content only) / delete (mgr/admin)   |
| PATCH        | /api/tasks/move  | yes  | move/reorder + WIP (409) + Done role (403) |
| POST         | /api/board/reset | yes  | reset to original                          |
| GET/POST     | /api/comments    | yes  | list/add comments                          |
| GET          | /api/activity    | yes  | recent activity                            |
| GET          | /api/stats       | yes  | dashboard analytics                        |
| GET          | /api/users       | yes  | team roster (assignee picker)              |
| GET          | /api/stream      | yes  | SSE change stream (local/single-instance)  |

## 7. Non-functional

- **Responsive:** below 900px columns become full-width swipeable panels with a tab bar.
- **Polish:** loading skeletons, empty & error states, toasts, dark/light theme (no-flash).
- **Security:** hashed passwords, JWT verified in middleware, service key server-only, Zod validation, role checks. The browser Supabase client uses only the public anon key and only for Realtime.

## 8. Acceptance criteria (definition of done)

- Unauthed `GET /api/tasks` → 401.
- `POST /api/import` returns `13 issues fixed · 37 tasks loaded`; badge shows exact text; `npm run test:clean` passes.
- 6th card into In Progress → server 409 → card returns + toast. Creating into a full column → 409.
- A **member**: cannot create/edit/delete (403 + no UI); cannot move a task into or out of **Done** (403); can drag/reorder elsewhere; can comment.
- Editing a task cannot change its column (status not accepted by PATCH).
- 3 moves then 3 Ctrl+Z restore the exact previous board.
- A filter does not change column totals or WIP behaviour.
- Refresh & re-login keep the board (DB); Reset restores original.
- Assigning a task to a user creates an `assigned` activity and notifies that user.
- Two open sessions see each other's changes live (Realtime or ≤5s polling).
- Works below 900px; UI is clean and consistent.
