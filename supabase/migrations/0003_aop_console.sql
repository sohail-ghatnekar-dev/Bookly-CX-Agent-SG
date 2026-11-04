-- The AOP console: draft versions, simulation runs against a draft, and an audit log of every change.
-- All of it is written by the console function (service role). Clients read none of it directly.

-- A version is a draft until it's published. Seeded versions count as published when they were created.
alter table procedures add column published_at timestamptz;
alter table procedures add column author text;
alter table procedures add column note text not null default '';
update procedures set published_at = created_at, author = 'Bookly CX' where not is_redteam;

-- The app's Procedures screen shows published versions only.
drop policy "non-redteam procedures" on procedures;
create policy "published procedures" on procedures
  for select to authenticated
  using (not is_redteam and published_at is not null);

-- Simulations run from the console are kept for their traces, but stay out of Watchtower.
alter table conversations add column source text not null default 'live'
  check (source in ('live', 'simulation'));

create table simulation_runs (
  id uuid primary key default gen_random_uuid(),
  procedure text not null,
  version int not null,
  scenario_ids text[] not null,
  started_by text not null,
  created_at timestamptz not null default now()
);

create index simulation_runs_version on simulation_runs (procedure, version, created_at desc);

create table simulation_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references simulation_runs(id) on delete cascade,
  scenario_id text not null,
  passed boolean not null,
  outcome text not null check (outcome in ('resolved', 'escalated', 'failed')),
  failures text[] not null default '{}',
  replies text[] not null default '{}',
  conversation_id uuid references conversations(id) on delete set null,
  ms int not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id, scenario_id)
);

create table aop_events (
  id uuid primary key default gen_random_uuid(),
  procedure text not null,
  version int,
  action text not null check (action in ('draft_saved', 'simulation_run', 'published', 'rolled_back')),
  actor text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);

alter table simulation_runs enable row level security;
alter table simulation_results enable row level security;
alter table aop_events enable row level security;
