-- Identity moves from email + ZIP to the order number and the email on that order.
-- The procedure text below matches seed.sql; this updates databases seeded before the change.

update procedures set body = $$Goal: tell the customer where their order is.
1. Verify identity first: you need the order number and the email on that order. Ask for what's missing. Never reveal anything about an order before verify_customer succeeds.
2. If verification fails, say you couldn't match those details and ask them to check. Don't say which part was wrong. After two failures, offer to send the chat to a Bookly employee.
3. After verifying, call get_order_status for that order. If they ask about a different order, or about their orders in general, call list_orders. If more than one is open and they haven't said which, list them by title and ask which one. Don't guess.
4. Report status, carrier, tracking number, and estimated delivery in plain language.
5. If the order is shipped and past its estimated delivery, say so plainly and offer to send the chat to a Bookly employee.$$
where name = 'order_status' and version = 1;

update procedures set body = $$Goal: help the customer return an item, only when policy allows.
1. Verify identity first: the order number and the email on that order. Same rules as order status.
2. Ask which item they want to return. If more than one could match, ask which. Don't guess.
3. Ask the reason: damaged or defective, or changed their mind. The reason decides the window, so ask before checking.
4. Call check_return_eligibility. Its answer is final. Never promise a return before it says eligible.
5. If eligible, confirm item and reason in one sentence, then call initiate_return and give the RMA number and what happens next.
6. If not eligible, explain the rule in plain words and offer what is allowed. For example, if a change-of-mind return is past 30 days, ask whether the item arrived damaged.$$
where name = 'returns' and version = 2;

update procedures set body = $$Goal: help the customer return an item, only when policy allows.
1. Verify identity first: the order number and the email on that order. Same rules as order status.
2. Ask which item they want to return. If more than one could match, ask which. Don't guess.
3. Ask the reason: damaged or defective, or changed their mind. The reason decides the window, so ask before checking.
4. Call check_return_eligibility. Its answer is final. Never promise a return before it says eligible.
5. If eligible, confirm item and reason in one sentence, then call initiate_return and give the RMA number and what happens next.
6. If not eligible, explain the rule in plain words and offer what is allowed. For example, if a change-of-mind return is past 30 days, ask whether the item arrived damaged.
7. If the customer pushes back after a denial, do not negotiate or look for workarounds. Offer to send the chat to a Bookly employee and call escalate_to_human with everything learned.$$
where name = 'returns' and version = 3;

update procedures set body = $$Goal: help the customer return an item, only when policy allows.
1. Verify identity first: the order number and the email on that order. Same rules as order status.
2. Call get_order_status on the order they gave to see its items; don't ask them to describe the order. If more than one item could match, ask which. Don't guess.
3. Ask the reason: damaged or defective, or changed their mind. The reason decides the window, so ask before checking.
4. Call check_return_eligibility. Its answer is final. Never promise a return before it says eligible.
5. If eligible, confirm item and reason in one sentence, then call initiate_return and give the RMA number and what happens next.
6. If not eligible, explain the rule in plain words and offer what is allowed. For example, if a change-of-mind return is past 30 days, ask whether the item arrived damaged.
7. If the customer pushes back after a denial, do not negotiate or look for workarounds. In that same reply, call escalate_to_human with everything learned, then tell them a Bookly employee will follow up. Don't ask whether they want one first.$$
where name = 'returns' and version = 4;

update procedures set body = $$Goal: answer questions about shipping, payments, refunds, and account help using only the policy documents.
1. Call get_policy. Answer only from what it returns.
2. End the reply with a line like: Sources: SHIP-2
3. If the documents don't cover the question, say you don't have that information and offer to send the chat to a Bookly employee. Don't guess, don't use outside knowledge, and don't say what other stores do.
4. You can't reset passwords. Explain the self-serve steps.
5. For questions about a specific order, switch to the order status or returns procedure.$$
where name = 'policy_qa' and version = 1;
