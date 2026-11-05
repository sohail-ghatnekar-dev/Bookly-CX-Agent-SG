-- Follow-ups the agent schedules with @schedule_follow_up: an email update to a verified customer about one of their
-- orders, so a late order can be handled without a person. Written by the agent's tools only.

create table follow_ups (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  customer_id uuid not null references customers(id) on delete cascade,
  order_number text not null,
  channel text not null default 'email' check (channel in ('email')),
  send_at timestamptz not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index follow_ups_order on follow_ups (order_number, send_at);
alter table follow_ups enable row level security;
