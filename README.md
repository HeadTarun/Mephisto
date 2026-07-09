# Sprintly

Sprintly is a Next.js App Router Kanban/sprint board MVP with custom JWT auth, Supabase persistence, server-side role/WIP enforcement, data cleaning, comments, activity, dashboard charts, and realtime/polling refresh.

## Run

1. Paste your environment values into `.env`:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

2. For a fresh Supabase project, run `supabase/schema.sql` once in the Supabase SQL editor.

3. Start the app:

```bash
npm install
npm run dev
```

4. Open `http://localhost:3000`, log in, then click `Import`.

Seed accounts created by `supabase/schema.sql`:

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@sprintly.local` | `AdminPass123!` |
| Manager | `manager@sprintly.local` | `ManagerPass123!` |
| Member | `member@sprintly.local` | `MemberPass123!` |

## Verify

```bash
npm run test:clean
npm run lint
npm run build
```

Expected clean-data output:

```text
13 issues fixed · 37 tasks loaded
```

## Demo Notes

- Members can view, comment, and move non-Done tasks, but cannot create/edit/delete or move tasks into/out of Done.
- Managers/admins can create, edit, delete, reset, import, and move all tasks.
- WIP limits are server-enforced: `In Progress` max 5 and `Review` max 3.
- Filters hide cards visually only; column totals still use the full board data.
- If public Supabase realtime env vars are present, the board subscribes to realtime changes; otherwise it refreshes every 5 seconds.
