-- AOPs as data: each version names the tools it may call and carries a display title, so CX can add new AOPs
-- from the console. Test chats from the console's phone are kept apart from live chats and simulations.

alter table procedures add column title text;
alter table procedures add column tools text[] not null default '{}';

update procedures set title = 'Order status', tools = '{verify_customer,list_orders,get_order_status}'
  where name = 'order_status';
update procedures set title = 'Returns',
  tools = '{verify_customer,list_orders,get_order_status,check_return_eligibility,initiate_return}'
  where name = 'returns';
update procedures set title = 'Policy questions', tools = '{get_policy}' where name = 'policy_qa';
update procedures set title = initcap(replace(name, '_', ' ')) where title is null;

alter table conversations drop constraint conversations_source_check;
alter table conversations add constraint conversations_source_check
  check (source in ('live', 'simulation', 'test'));

alter table aop_events drop constraint aop_events_action_check;
alter table aop_events add constraint aop_events_action_check
  check (action in ('created', 'draft_saved', 'draft_discarded', 'simulation_run', 'published', 'rolled_back', 'retired'));
