create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null default 'member' check (role in ('admin', 'manager', 'member')),
  avatar text,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id text primary key,
  title text not null,
  description text not null default '',
  status text not null check (status in ('Backlog', 'In Progress', 'Review', 'Done')),
  assignee text not null default 'Unassigned',
  priority text not null default 'med' check (priority in ('low', 'med', 'high')),
  labels text[] not null default '{}',
  due_date date,
  estimate_hours integer not null default 0 check (estimate_hours >= 0),
  completed_date date,
  position integer not null default 0,
  has_warning boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.tasks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  task_id text references public.tasks(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  action text not null check (
    action in (
      'created',
      'moved',
      'completed',
      'reordered',
      'assigned',
      'unassigned',
      'deleted',
      'imported',
      'reset'
    )
  ),
  from_status text,
  to_status text,
  created_at timestamptz not null default now()
);

create index if not exists tasks_status_position_idx on public.tasks (status, position);
create index if not exists tasks_assignee_idx on public.tasks (assignee);
create index if not exists comments_task_created_idx on public.comments (task_id, created_at desc);
create index if not exists activity_created_idx on public.activity_log (created_at desc);
create index if not exists activity_task_created_idx on public.activity_log (task_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

alter table public.users disable row level security;
alter table public.tasks disable row level security;
alter table public.comments disable row level security;
alter table public.activity_log disable row level security;

insert into public.users (name, email, password_hash, role, avatar)
values
  (
    'Avery Admin',
    'admin@sprintly.local',
    '$2b$12$WIUND8Z8Byq9Qm6AG8WD4ue1pf8052PbIjKXFEbKoGT5h4/eLe/Cm',
    'admin',
    null
  ),
  (
    'Maya Manager',
    'manager@sprintly.local',
    '$2b$12$HEzdNlmKGjM6TSXUHMV7xuYxvzcro2nSRu3RvszHss6dY1cqjIKPi',
    'manager',
    null
  ),
  (
    'Milo Member',
    'member@sprintly.local',
    '$2b$12$hEFWZ1dHy74vvz2Jt1lRmeJ167k9qlC36aPMrc0kbKd2xbRyT2hDy',
    'member',
    null
  )
on conflict (email) do update
set
  name = excluded.name,
  password_hash = excluded.password_hash,
  role = excluded.role,
  avatar = excluded.avatar;
