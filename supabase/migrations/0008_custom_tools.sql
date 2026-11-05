-- Tools added from the console's Build › Tools page. They're the request for a tool: engineering builds and deploys
-- it, and until then it shows as unused and can't be referenced in an AOP. Written by the console function only.

create table custom_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z][a-z0-9_]{2,39}$'),
  description text not null,
  type text not null check (type in ('coded', 'api', 'integration')),
  method text check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  url text,
  inputs jsonb not null default '[]',
  guardrails text not null default '',
  created_by text not null,
  created_at timestamptz not null default now()
);

alter table custom_tools enable row level security;
