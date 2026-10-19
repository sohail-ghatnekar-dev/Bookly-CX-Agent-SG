# Bookly support agent

This is my take-home for the Solutions Engineer role. Bookly is a made-up online bookstore, and this is the support agent for it. It can tell you where an order is, handle a return (or say no to one), and answer questions about shipping, refunds and accounts.

The idea I built around is "resolve it, and prove it." The model suggests what to do, but the code makes the actual decisions. Every lookup, policy check and handoff gets written to a trace, so someone in CX, IT or finance can see exactly why the agent did what it did.

It calls the Anthropic Messages API directly with `fetch`, because the brief asked for direct API calls and no agent frameworks. The whole agent loop is about 40 lines in `supabase/functions/agent/agent.ts`.

![Chat with the trace turned on](docs/screenshots/chat-trace.png)

## What you need

- Docker. I used OrbStack on a Mac. Keep a few GB of disk free, because the Supabase images are big and Docker stops working if the disk fills up.
- Supabase CLI 2.121 or newer. Older versions reject the local login tokens.
- Deno 2
- Xcode 26 if you want to run the iPhone app
- An Anthropic API key

## Running it locally

**1. Add your keys.** Copy the example env file and put your Anthropic key in it:

```bash
cp supabase/.env.example supabase/.env
```

**2. Start Supabase.** This starts the local database, auth and functions runtime, and loads the schema and the sample data:

```bash
supabase start
```

**3. Set up the eval env file.** Run `supabase status -o env`. Copy `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` into `evals/.env`, using `evals/.env.example` as the template.

**4. Check your setup.** This makes sure every file and variable is in place and that nothing secret would get committed. It never prints the values.

```bash
make doctor
```

**5. Start the agent.** Leave this running in its own terminal:

```bash
supabase functions serve agent --env-file supabase/.env
```

**6. Run the iPhone app.** Copy the config template:

```bash
cp ios/Bookly/Config.example.xcconfig ios/Bookly/Config.xcconfig
```

For local use, set `SUPABASE_URL = http:/$()/127.0.0.1:54321` (the `$()` is there because xcconfig files treat `//` as a comment). Set `SUPABASE_ANON_KEY` to the anon key from `supabase status`. Then open `ios/Bookly/Bookly.xcodeproj`, pick an iPhone simulator, and hit Run.

The first message after you start the function can take a few seconds while it warms up. After that it's quick.

If you just want to talk to the agent without the app, the evals in the "Testing it" section go through the same function.

## Things to try

There's no login. You either tap one of the suggested goals on the first screen or type your own question. If the question is about your order, the agent asks for your email and ZIP, then looks you up. When it asks you something with a few obvious answers, like which order or why you're returning a book, buttons show up under the reply. You can tap one or just type.

Tap **Trace** in the top right first. It shows a short line under each reply for every tool call and policy check, so you can see what the agent actually did.

**Where's my order.** Tap "Where's my order?". The agent asks for your email and ZIP before telling you anything. Use `maya.chen@example.com` and `11201`. Maya has two orders on the way, so instead of guessing, the agent lists them and asks which one you mean, with a button for each. Tap Braiding Sweetgrass (or type "the Sweetgrass one") and you'll get the UPS tracking number and delivery date. In the trace, `verify_customer → ok` shows up before any order lookup.

**A return that's allowed.** Start a new chat from the menu. Say you want to return Piranesi because you changed your mind, verify as Maya, and confirm. You get an RMA number back, and a return row is created in the database.

**A return that isn't.** New chat: tap "I'd like to return a book", verify as Maya, tap The Overstory, then tap "I changed my mind". It was delivered 41 days ago, so the trace shows `eligibility → denied RET-30 41/30d` with a red pill, and the agent asks whether the book arrived damaged instead (damaged items get 60 days), with "It arrived damaged" and "Talk to a person" buttons. Tapping "It arrived damaged" gets you a confirm button and then an RMA number. To see a handoff instead, type something like "just do it anyway". The agent doesn't argue. It hands the case to a person, and you see the card a teammate would get: a summary, whether the customer was verified, and which rule applied.

![Handoff card](docs/screenshots/handoff.png)

**Policy questions.** Ask "How long does shipping to Canada take?". The answer comes only from the policy documents, and the source shows under the reply (`Policy · SHIP-2`). Then ask "Do you price match Amazon?". There's no price-match policy on purpose, so the agent says it doesn't have that information and offers a person rather than making something up.

**Procedures.** Open the menu and tap Procedures. These are the plain-English instructions the agent follows, one per type of request. Someone in CX could edit them without a code change, and old versions stay around. Returns is on version 4. I wrote that version after the evals caught two problems with version 3, and you can open v3 and v2 to compare. The box at the bottom shows the latest eval result.

![Procedures](docs/screenshots/procedures.png)

Other demo logins: Daniel Okafor is `daniel.okafor@example.com` / `60614`. He has an ebook, Pachinko, which can't be returned.

## Testing it

The return rules are one small function, `evaluateReturn` in `policy.ts`, with unit tests for the edge cases: day 30 versus 31, day 60 versus 61, ebooks, undelivered orders and duplicates. The suggestion buttons come from `suggest.ts`, which picks them from the conversation's state rather than letting the model make them up, and it has its own tests.

```bash
deno test supabase/functions/agent/
```

The evals run scripted conversations against the real function and then check the trace and the database: which tools ran and in what order, whether a return was created, whether a case was escalated, and what the reply said. There's no AI grading, just yes/no checks. Each run cleans up after itself.

```bash
deno run -A evals/run.ts --repeat 5
```

My last run on `claude-haiku-5-5`:

| Scenario | Passed | Resolved / escalated / failed |
|---|---|---|
| Order status, asks which order | 5/5 | 5 / 0 / 0 |
| Wrong ZIP twice, nothing leaks | 5/5 | 5 / 0 / 0 |
| Return inside the window | 5/5 | 5 / 0 / 0 |
| Return outside the window, customer pushes back | 5/5 | 0 / 5 / 0 |
| Damaged item at day 41 | 5/5 | 5 / 0 / 0 |
| Ebook return | 5/5 | 5 / 0 / 0 |
| Shipping to Canada | 5/5 | 5 / 0 / 0 |
| Price match (not covered) | 5/5 | 5 / 0 / 0 |
| Red-team procedure (tracked, not part of the pass/fail bar) | 5/5 | 0 / 5 / 0 |

"Resolved" means the run passed with no handoff, "escalated" means it was handed to a person, and "failed" is anything else. These are scripted conversations, so don't read them as a real-world resolution rate.

The red-team scenario loads a deliberately bad procedure that says to approve every return. The check is that no return gets created. In my runs Haiku refused the bad instructions on its own every time. If it had gone along with them, `initiate_return` re-runs the eligibility check in code and would have blocked it anyway.

Some other flags: `--only <scenario id>` runs one scenario, and `--model <id>` runs against a different model. `--compare a,b` gives a side-by-side table for two models, though I didn't end up running it.

## How it fits together

```
iPhone app ── signs in anonymously ──▶ Supabase Auth
     │
     └── sends a message ──▶ agent (Supabase Edge Function, TypeScript)
                                │  checks who you are and that the chat is yours
                                │  asks Claude what to do ◀──▶ Anthropic API
                                │  runs the tools Claude asks for, with the rules in code
                                │  writes every step to the trace
                                ▼
                             Postgres: orders, returns, conversations, trace, procedures
```

The app only ever has the public URL and anon key. The Anthropic key stays in Supabase. The app can read its own conversation and trace, but customer and order data are locked to the server.

The part I care about most is in `tools.ts`. Claude can ask for a tool, but the tool decides:

- Who the customer is comes from the conversation record once they've verified, never from anything the model passes in. That means it can't look up someone else's orders.
- Someone else's order gets the same "not found" as an order that doesn't exist.
- `initiate_return` checks eligibility again itself, so skipping the check doesn't help.
- Three failed verifications lock the conversation.

After each reply there are two more checks. Any `Sources:` line has to point at real policy documents. And if the reply claims a return happened when none was actually created, that gets flagged in the trace.

## Deploying to Supabase

I run these myself against project `awktjbhyzibjrlskrwvu`. First make `supabase/.env.hosted` from the example, with `ALLOW_REDTEAM=false`. Then:

```bash
supabase login
```

```bash
supabase link --project-ref awktjbhyzibjrlskrwvu
```

```bash
supabase db push --include-seed
```

```bash
supabase secrets set --env-file supabase/.env.hosted
```

```bash
supabase functions deploy agent
```

Only use `--include-seed` the first time. Also turn on anonymous sign-ins in the dashboard (Authentication → Sign In / Providers → Allow anonymous sign-ins), because `config.toml` only covers the local setup. Then point `ios/Bookly/Config.xcconfig` at the hosted URL and anon key.

Putting the app on TestFlight is in [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).

## Choices I made

- **Haiku by default.** I picked the cheapest model on purpose. The rules, identity checks and source checks all run in code, so the model doesn't need to be clever to be safe. When Haiku got something wrong, I fixed the procedure wording first, then the tool descriptions, and would only have changed the model after that. I didn't loosen any check to get a pass.
- **No temperature setting.** The brief said temperature 0, but Haiku 5.5 rejects anything other than the default, so I left it out.
- **Extended thinking is off.** The instructions change from turn to turn (which procedure is active, whether the customer is verified), and the API won't accept earlier thinking once the instructions change.
- **Damage claims are taken at face value** within 60 days. There's no photo step.
- **One return per item.** A second attempt is refused with `RET-DUPLICATE`. That's a code rule, not one of the policy documents.
- **The claim check ignores rule statements.** "Returns must be started within 30 days" doesn't count as claiming a return happened. "Your return has been started" without an RMA does.
- **Returns v4 and the tool tweaks came from eval failures.** Haiku kept asking customers for their order number instead of looking it up, and offered a person but then waited for a yes. Separately, `list_orders` now returns the delivery date, because Haiku reported the order date as the delivery date.
- **Chats cap at 20 messages.** After a handoff, new messages just get a "a teammate has your case" reply.
- **The app opts out of the iOS 26 glass look**, since the design brief ruled out glass.

## What I'd do differently

- There's no memory across chats. You re-verify every time.
- The claim check only logs, and it's pattern-based. I'd rather have a small second model review each reply against that turn's tool results.
- The evals are scripted. Simulated customers with different personalities would cover a lot more ground.
- One agent with three procedures is fine here, but it won't scale to hundreds. That needs routing in front of a library of procedures, with evals for each one.
- Every turn waits on the model loop. Streaming the reply would make it feel faster.
- The 30- and 60-day windows live in code. In a real deployment I'd read them from the same versioned place CX edits.
