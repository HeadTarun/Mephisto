# Mephisto — Sprint Board — CLAUDE.md

> Project instructions for Claude. **Read this first, every session.**
> Then read `spec.md` (what to build) and `plan.md` (how), and work through `task.md` phase by phase.

## What this is
**Mephisto** — a full-stack **Kanban / Sprint Board** (team task manager). Frontend **and** backend live in ONE Next.js App Router project. Data on Supabase (Postgres). Custom JWT auth. Role-based permissions, server-enforced WIP limits, data cleaning on import, in-app notifications, and real-time board updates.

## Stack (fixed — do not swap)
- **Next.js (App Router) + TypeScript** — UI in `app/`, backend in `app/api/**/route.ts`
- **Supabase (Postgres)** — **RLS is DISABLED**; backend uses the **service-role key** (server only)
- **Auth: custom JWT** — signed/verified with **`jose`** (Edge-safe). NOT Supabase Auth.
- **Passwords:** `bcryptjs` · **Drag & drop:** `@dnd-kit/*` · **Validation:** `zod` · **Charts:** `recharts` · **Styling:** Tailwind CSS
- **Real-time:** Supabase **Realtime** (browser anon key) with a **polling fallback**. Optional SSE endpoint for single-instance/local.

## Commands
```
dev:    npm run dev
build:  npm run build
lint:   npm run lint
test:   npm run test:clean   # unit-tests lib/clean.ts (Data Health numbers)
```

## Folder layout (follow this)
```
src/
  middleware.ts               # JWT route protection
  data/tasks.json             # dirty seed data (40 records)
  lib/                        # supabase.ts, supabaseBrowser.ts, jwt.ts, auth.ts,
                              # clean.ts, dates.ts, events.ts, response.ts, api.ts, types.ts
  components/                 # Toast, ThemeToggle, Modal, TopBar, NotificationBell,
                              # useLive, ui.tsx, board/*, dashboard/*
  app/
    login/ , board/ , dashboard/    # pages (UI)
    api/                            # route handlers (backend)
      auth/{login,signup,logout}/route.ts
      tasks/route.ts , tasks/[id]/route.ts , tasks/move/route.ts
      import/route.ts , board/reset/route.ts
      comments/route.ts , activity/route.ts , stats/route.ts
      users/route.ts , stream/route.ts
supabase/
  schema.sql                  # tables (run once) · realtime.sql (optional Realtime)
```

## Roles & permissions (server-enforced — client must not bypass)
- Roles: **admin**, **manager**, **member**. Public signup always creates a **member**; manager/admin are granted out-of-band (seed/admin).
- **member**: view board, **drag to change status/reorder**, comment. **Cannot** create / edit / delete tasks.
- **member + Done**: cannot move a task **into or out of** Done (Done is manager/admin territory). Done cards are drag-disabled for members.
- **manager / admin**: full create / edit / delete + all moves.

## Non-negotiable rules
1. **TypeScript strict.** No `any` without a comment. Validate every API input with **Zod**.
2. **Secrets server-only** — `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` never reach the browser. Only `NEXT_PUBLIC_*` (anon key/url, for Realtime) may. Read from `.env.local`.
3. **All business logic on the backend** — WIP limits, role checks, data cleaning. The client must not be able to bypass a rule (e.g. status changes only via `/api/tasks/move`, never via the edit form).
4. **JWT via `jose`** (works in Edge middleware). Do not use `jsonwebtoken` in `middleware.ts`.
5. **Standard API response** — success: `{ ok: true, data }`, error: `{ ok: false, error }` with correct HTTP status (400 validation, 401 auth, 403 role, 409 WIP conflict).
6. **Every async op has error handling**; every screen has loading + empty + error states.
7. **Supabase service client only from server code** (route handlers / lib). The browser Supabase client (anon key) is used ONLY for Realtime subscriptions, never to read/write business data.
8. Keep components small; UI in client components only when interactive, else server components.

## How to work
- Follow **`task.md` in order**, phase by phase. Finish a phase's checkpoint before the next.
- Re-read `spec.md` for exact requirements (cleaning rules, WIP numbers, Data Health text, role matrix).
- After each phase, state what was done and how to verify it.
- Ask before changing the fixed stack or the data model.
