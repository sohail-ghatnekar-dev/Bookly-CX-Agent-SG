-- Reporting and testing: each chat can carry a topic label and a CSAT rating, and each simulation result keeps
-- its checks one by one. Generated demo usage (scripts/seed-usage.ts) is marked synthetic so it can be removed.

alter table conversations add column topic text;
alter table conversations add column csat smallint check (csat between 1 and 5);
alter table conversations add column synthetic boolean not null default false;
create index conversations_source_created on conversations (source, created_at desc);

alter table customers add column synthetic boolean not null default false;

alter table simulation_results add column checks jsonb not null default '[]';
