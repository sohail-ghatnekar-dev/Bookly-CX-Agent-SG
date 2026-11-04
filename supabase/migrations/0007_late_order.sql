-- A late order for the demo: Daniel's BK-1072 shipped but is past its estimated delivery date. The late-orders
-- AOP that Autopilot suggests is tried against it. scripts/reset-demo.ts keeps it 3 days late.

insert into orders (order_number, customer_id, placed_at, status, carrier, tracking_number, estimated_delivery, delivered_at, total_cents)
select 'BK-1072', c.id, now() - interval '9 days', 'shipped', 'USPS', '9400111899223344559988', (now() - interval '3 days')::date, null, 1899
from customers c where c.email = 'daniel.okafor@example.com'
on conflict (order_number) do nothing;

insert into order_items (order_id, line_code, title, author, format, price_cents)
select o.id, 'BK-1072-1', 'Tomorrow, and Tomorrow, and Tomorrow', 'Gabrielle Zevin', 'paperback', 1899
from orders o where o.order_number = 'BK-1072'
on conflict (line_code) do nothing;
