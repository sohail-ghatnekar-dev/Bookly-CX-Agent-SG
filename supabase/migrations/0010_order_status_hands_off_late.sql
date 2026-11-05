-- Order status v2: a late order goes to the late-orders AOP when one exists, and to a person only when it doesn't.
-- Without this, a chat that opens with "Where's my order?" stays in Order status and its step 5 hands every late
-- order to a person, even after a Late orders AOP is published. Skipped on a fresh database, where seed.sql adds v2.

do $$
declare
  v2 text := $b$Goal: tell the customer where their order is.
1. Verify identity first: you need the order number and the email on that order. Ask for what's missing. Never reveal anything about an order before @verify_customer succeeds.
2. If verification fails, say you couldn't match those details and ask them to check. Don't say which part was wrong. After two failures, offer to send the chat to a Bookly employee.
3. After verifying, call @get_order_status for that order. If they ask about a different order, or about their orders in general, call @list_orders. If more than one is open and they haven't said which, list them by title and ask which one. Don't guess.
4. Report status, carrier, tracking number, and estimated delivery in plain language.
5. If the order is shipped and past its estimated delivery and another procedure is for late orders, switch to it straight away, before you reply, and follow it. Don't ask the customer first or mention it. Only if there isn't one, say the order is late and offer to send the chat to a Bookly employee.$b$;
begin
  if exists (select 1 from procedures where name = 'order_status' and version = 1)
     and not exists (select 1 from procedures where name = 'order_status' and version = 2) then
    update procedures set is_active = false where name = 'order_status' and is_active;
    insert into procedures (name, version, title, is_active, is_redteam, created_at, published_at, author, note, body, tools)
    values ('order_status', 2, 'Order status', true, false, now(), now(), 'Bookly CX',
      'Late orders go to a late-orders AOP when there is one', v2, aop_tools(v2));
    insert into aop_events (procedure, version, action, actor, detail)
    values ('order_status', 2, 'published', 'Bookly CX', 'replaces v1');
  end if;
end $$;
