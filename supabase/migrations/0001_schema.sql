-- Bookly support agent schema.
-- RLS is on for every table. Clients only read their own conversation data,
-- non-red-team procedures, and eval runs. All writes go through the edge function (service role).

create table customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  postal_code text not null
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid not null references customers(id),
  placed_at timestamptz not null,
  status text not null check (status in ('processing', 'shipped', 'delivered', 'cancelled')),
  carrier text,
  tracking_number text,
  estimated_delivery date,
  delivered_at timestamptz,
  total_cents int not null
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  line_code text not null unique,
  title text not null,
  author text not null,
  format text not null check (format in ('hardcover', 'paperback', 'ebook')),
  price_cents int not null
);

create table policy_docs (
  id text primary key,
  title text not null,
  body text not null
);

create table procedures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null,
  body text not null,
  is_active boolean not null default false,
  is_redteam boolean not null default false,
  created_at timestamptz not null default now(),
  unique (name, version)
);

-- At most one active version per procedure.
create unique index procedures_one_active on procedures (name) where is_active;

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'escalated')),
  verified_customer_id uuid references customers(id),
  verify_failures int not null default 0,
  current_procedure text,
  current_version int,
  created_at timestamptz not null default now()
);

create index conversations_user_id on conversations (user_id);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq int not null,
  turn int not null,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  unique (conversation_id, seq)
);

create table trace_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  turn int not null,
  seq int not null,
  kind text not null check (kind in ('procedure', 'tool', 'guard', 'grounding', 'escalation')),
  label text not null,
  detail text not null default '',
  outcome text not null check (outcome in ('ok', 'denied', 'blocked', 'flagged', 'error')),
  rule_id text,
  ms int not null default 0,
  input jsonb,
  output jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);

create table returns (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references order_items(id),
  conversation_id uuid references conversations(id) on delete set null,
  reason_code text not null check (reason_code in ('damaged_defective', 'changed_mind')),
  rma_number text not null unique,
  created_at timestamptz not null default now()
);

create table escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  summary text not null,
  reason text not null,
  verified boolean not null,
  rule_ids text[] not null default '{}',
  customer_name text,
  created_at timestamptz not null default now()
);

create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  model text not null,
  total int not null,
  passed int not null,
  resolved int not null,
  escalated int not null,
  failed int not null
);

alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table policy_docs enable row level security;
alter table procedures enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table trace_events enable row level security;
alter table returns enable row level security;
alter table escalations enable row level security;
alter table eval_runs enable row level security;

-- customers, orders, order_items, returns, policy_docs: no client policies.

create policy "own conversations" on conversations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own messages" on messages
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id and c.user_id = (select auth.uid())
  ));

create policy "own trace events" on trace_events
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = trace_events.conversation_id and c.user_id = (select auth.uid())
  ));

create policy "own escalations" on escalations
  for select to authenticated
  using (exists (
    select 1 from conversations c
    where c.id = escalations.conversation_id and c.user_id = (select auth.uid())
  ));

create policy "non-redteam procedures" on procedures
  for select to authenticated
  using (not is_redteam);

create policy "eval runs" on eval_runs
  for select to authenticated
  using (true);
