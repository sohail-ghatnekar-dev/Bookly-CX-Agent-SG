-- AOPs reference tools with @ and other AOPs with #, as in Decagon's editor. The tools an AOP can call are the ones
-- its text references; the console works that out on every save, and aop_tools() does the same here for backfills.

create function aop_tools(body text) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct m[2] order by m[2]), '{}')
  from regexp_matches(body, '(^|[\s(])@([a-z_]+)', 'g') as m
  where m[2] in ('verify_customer', 'list_orders', 'get_order_status', 'check_return_eligibility',
                 'initiate_return', 'get_policy');
$$;

-- Bare tool names become @references, and "order status" / "returns" become #references.
update procedures set body = regexp_replace(body,
  '(^|[^@\w])(verify_customer|list_orders|get_order_status|check_return_eligibility|initiate_return|get_policy|escalate_to_human)\M',
  '\1@\2', 'g');
update procedures set body = replace(body,
  '1. Verify identity first: the order number and the email on that order. Same rules as order status.',
  '1. Verify identity first with @verify_customer: the order number and the email on that order. Same rules as #order_status.');
update procedures set body = replace(body,
  '5. For questions about a specific order, switch to the order status or returns procedure.',
  '5. For questions about a specific order, switch to #order_status or #returns.');

update procedures set tools = aop_tools(body) where not is_redteam;
