# Mephisto — Implementation Plan (plan.md)

> HOW to build it. Architecture, decisions, sequencing. Claude: build in the phase order below; each phase ends at a verifiable checkpoint.

## Architecture

```
Browser (React UI)  ──►  Next.js server (route handlers + middleware)  ──►  Supabase (Postgres)
   login/board/dashboard      auth · JWT verify · business rules · cleaning      users/tasks/comments/activity
        │                                                                                 ▲
        └───────────────  Supabase Realtime (anon key, subscribe only)  ──────────────────┘
```

- Frontend = client components only where interactive (board, forms, filters, bell). Data pages fetch via `/api/*`.
- Backend = `app/api/**/route.ts`. All DB writes + rules here (service-role client). No business data read/written from the browser.
- Middleware = `src/middleware.ts` verifies JWT (jose) on protected matchers.
- Real-time = browser subscribes to Supabase Realtime (anon key) for change signals, or polls every 5s if not configured.

## Key decisions

- **Auth:** JWT in an **httpOnly cookie** named `token`; payload `{ userId, role, name }`; 2h expiry; sign/verify with `jose`.
- **Supabase:** server client in `lib/supabase.ts` (service-role, RLS off). Optional browser client in `lib/supabaseBrowser.ts` (anon key) for Realtime only.
- **API shape:** helper in `lib/response.ts` → `ok(data)` / `fail(status, msg)` / `guard(fn)`.
- **Validation:** Zod schema per endpoint; invalid → 400. `PatchBody` is `.strict()` and omits `status`/`position` so edits can't move columns.
- **Roles + WIP:** enforced inside `/api/tasks/move` (move) and `/api/tasks` + `/api/tasks/[id]` (create/edit/delete). Member → 403 for create/edit/delete and for any Done in/out move.
- **Cleaning:** pure function `lib/clean.ts` (unit-tested), used by `/api/import` and `/api/board/reset`.
- **Move/reorder:** server recomputes positions for the affected columns; pointer-based DnD collision so empty columns accept drops.
- **Undo/redo:** client history stacks of single moves; each undo/redo replays the inverse/forward move through `/api/tasks/move`.
- **Notifications:** every mutation writes `activity_log`; the bell polls/subscribes and toasts relevant new events.
- **Real-time:** `useLive(onChange)` hook → Supabase Realtime if env present, else 5s polling. Mutations also call `notifyChange()` (in-memory bus → `/api/stream` SSE) for local single-instance push.
- **Persistence:** source of truth = DB. (Optional localStorage for Data Health badge + notification "last seen".)

## Dependencies

```
@supabase/supabase-js  jose  bcryptjs  @dnd-kit/core  @dnd-kit/sortable  @dnd-kit/utilities  zod  recharts
```

## Environment (.env.local)

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=          # server only
JWT_SECRET=                         # >= 32 chars
# optional — instant realtime (public, safe in browser):
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Database setup

Run `supabase/schema.sql` (users, tasks, comments, activity_log; RLS off). Seed users for each role (bcrypt-hashed). Optionally run `supabase/realtime.sql` to add `tasks` + `activity_log` to the `supabase_realtime` publication.

## Build phases (order matters)

- **Phase 0 — Setup:** create-next-app, install deps, `.env.local`, Supabase tables + seed users, `lib/` (supabase, jwt, auth, response, types).
- **Phase 1 — Auth:** signup/login/logout routes (signup forces member), `middleware.ts`, login/signup page. **Checkpoint:** unauthed `/api/tasks` → 401; login sets cookie; logout clears it.
- **Phase 2 — Data + Board (read):** `lib/clean.ts` (+ unit test), `/api/import`, `/api/tasks` (GET), board page with 4 columns, Data Health badge, column count/hours + Done week-hours. **Checkpoint:** clean data renders; badge = `13 issues fixed · 37 tasks loaded`; test passes.
- **Phase 3 — Task engine + WIP + roles:** create/edit/delete (`/api/tasks`, `/api/tasks/[id]`), drag & drop (dnd-kit, pointer collision), `/api/tasks/move` with **WIP + role** enforcement, `/api/users` + assignee dropdown, `/api/board/reset`. Edit form content-only. **Checkpoint:** 6th card → 409 + toast; member can't create/edit/delete or touch Done; refresh persists; reset works.
- **Phase 4 — Collaboration + insights:** comments, activity_log writes (incl. assigned/unassigned), `/api/comments`, `/api/activity`, `/api/stats`, dashboard charts, filters, undo/redo, notification bell. **Checkpoint:** filters don't change totals; undo restores order; assigning notifies the assignee.
- **Phase 5 — Real-time + polish + deploy:** `useLive` (Realtime or polling), `/api/stream` SSE, responsive (<900px), theming, loading/empty/error states, toasts; deploy to Vercel. **Checkpoint:** two sessions update live; all acceptance criteria pass.

## Task dependencies (do not reorder across these)

- Auth + middleware **before** any protected API.
- Cleaning fn **before** import/reset.
- GET tasks + board **before** move/DnD.
- Move + activity write **before** activity feed / stats / notifications.
- Mutations + activity **before** real-time (there must be something to broadcast).

## Testing per phase

- Manual checkpoint after each phase (see above).
- Unit-test `lib/clean.ts` against the known Data Health numbers (`npm run test:clean`).
- Verify each protected endpoint returns 401 without a token, and 403 for member create/edit/delete + Done moves.
