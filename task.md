# Mephisto — Task Checklist (task.md)

> Do these in order, top to bottom. Tick `[x]` when done. Finish each phase's **CHECKPOINT** before moving on.

## Phase 0 — Setup
- [x] `npx create-next-app@latest` (App Router, TS, Tailwind, src/, alias `@/*`)
- [x] Install deps: `@supabase/supabase-js jose bcryptjs @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities zod recharts`
- [x] Create `.env.example` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (+ optional `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`); runtime uses pasted `.env`
- [x] Supabase: create project, run `supabase/schema.sql` (users, tasks, comments, activity_log), RLS off
- [x] Seed one user per role (admin/manager/member), bcrypt-hashed
- [x] Add `src/data/tasks.json` (dirty seed, 40 records)
- [x] `lib/`: `supabase.ts`, `supabaseBrowser.ts`, `jwt.ts` (sign/verify), `auth.ts` (currentUser), `response.ts` (ok/fail/guard), `types.ts`
- **CHECKPOINT:** app runs on localhost; Supabase tables exist.

## Phase 1 — Auth & protection
- [x] `POST /api/auth/signup` (Zod, hash password, insert user, **role forced to member**, set cookie)
- [x] `POST /api/auth/login` (verify, sign JWT, set httpOnly cookie `token`)
- [x] `POST /api/auth/logout` (clear cookie)
- [x] `src/middleware.ts` (verify JWT with jose; protect tasks/import/board/comments/stats/activity/users/stream + board/dashboard pages)
- [x] `login` page (login/signup toggle; signup has **no role picker**)
- **CHECKPOINT:** unauthed `GET /api/tasks` → 401; login sets cookie; logout clears it.

## Phase 2 — Data + Board (read)
- [x] `lib/clean.ts` — dedupe (keep later), parse 3 date formats, fix assignee, fix estimate, fix status(+warning), return `{cleaned, issuesFixed, tasksLoaded}`
- [x] Unit-test `clean.ts` → **13 issues fixed · 37 tasks loaded** (`npm run test:clean`)
- [x] `POST /api/import` (clean → wipe → insert → return counts → log activity → notifyChange)
- [x] `GET /api/tasks` (list, ordered by position)
- [x] `board` page: 4 columns, cards, ⚠ on has_warning
- [x] Header **Data Health badge**: `"N issues fixed · M tasks loaded"`
- [x] Column headers: count + total estimate hours; Done: hours completed this week (Mon–Sun, `lib/dates.ts`)
- **CHECKPOINT:** clean data renders; badge shows correct numbers.

## Phase 3 — Task engine + WIP + roles
- [x] `POST /api/tasks` (create) — **manager/admin only** (member 403); Zod; enforce WIP (409) + Done role (403); position at end
- [x] `PATCH /api/tasks/[id]` — **content only** (`.strict()`, no status/position); manager/admin only; log assign/unassign on assignee change
- [x] `DELETE /api/tasks/[id]` — manager/admin only
- [x] `GET /api/users` — team roster for the assignee dropdown
- [x] Task create/edit modal (status editable only on create; assignee = dropdown) + delete in detail
- [ ] Drag & drop with dnd-kit (DndContext, pointer collision, droppable columns, sortable cards, drop indicator)
- [x] `PATCH /api/tasks/move` — update status/position; **WIP** (In Progress 5, Review 3 → 409); **role** (member can't move in/out of Done → 403); reindex columns; log activity
- [x] UI: 409 → return card + shake/toast; member Done column locked; success → update state
- [x] `POST /api/board/reset` (re-import original) + Reset button
- **CHECKPOINT:** 6th card → 409 + toast; member can't create/edit/delete or move Done in/out; move persists after refresh; reset restores original.

## Phase 4 — Collaboration + insights
- [x] Write to `activity_log` on every move/create/complete/assign/unassign/delete
- [x] `GET/POST /api/comments` + comments UI in task detail
- [x] `GET /api/activity` + activity feed UI (dashboard)
- [x] `GET /api/stats` (tasks/status, hours/assignee, completed this week) + dashboard charts (recharts)
- [x] Filters: assignee select, title search, Overdue toggle — AND logic, **hide only** (totals/WIP use full data)
- [ ] Undo/Redo (Ctrl+Z / Ctrl+Shift+Z, ≥10 steps, backend sync via move)
- [ ] Notification bell (unread badge, feed, toast on others' events, highlight + toast when assigned to you)
- **CHECKPOINT:** filter doesn't change totals/WIP; 3 moves + 3 undo restore exact order; assigning notifies the assignee.

## Phase 5 — Real-time + polish + deploy
- [x] `useLive` hook — Supabase Realtime (unique channel per instance) if `NEXT_PUBLIC_*` set, else 5s polling
- [x] `notifyChange()` + `GET /api/stream` (SSE) for local single-instance push
- [x] `supabase/realtime.sql` (add tasks + activity_log to publication) — optional
- [ ] Responsive < 900px: swipeable full-width columns + tab bar
- [ ] Dark/light theme toggle (no-flash init)
- [ ] Loading skeletons, empty states, error states, toasts everywhere
- [ ] Consistent spacing/typography pass
- [ ] Deploy: Vercel (5 env vars) + Supabase live
- **CHECKPOINT:** two sessions update live; all acceptance criteria in spec.md §8 pass.

## Optional (stretch)
- [ ] File attachments (Supabase Storage) · @-mentions in comments · rate limiting · audit export
