# Bookly support agent

This is my take-home for the Solutions Engineer role. Bookly is a made-up online bookstore, and this is its support agent. It can tell you where an order is, start a return (or say no to one), and answer questions about shipping, refunds and accounts.

## The idea: resolve it, and prove it

A good support agent doesn't just answer questions. It fixes the problem, and you can see how it got there.

So I put deterministic checks first. The model suggests the next step, but my code provides the guardrails:

- **Code decides.** The model can only ask for a tool. The TypeScript tool checks who the customer is, whose orders they can see, and whether a return is in policy before anything happens.
- **Nothing guessed.** Facts come only from tool results, any policy it cites has to exist, and an unclear request gets a question.
- **Everything audited.** Each tool call and policy check goes into a trace, with the rule that made the call.

![Chat with the trace turned on](docs/screenshots/chat-trace.png)

## Running it locally

You need:

- Docker. I used OrbStack on a Mac. Keep a few GB of disk free, because the Supabase images are big.
- Supabase CLI 2.121 or newer
- Deno 2
- Xcode 26 for the iPhone app
- An Anthropic API key

**1. Add your key.** Copy the example env file and put your Anthropic key in it:

```bash
cp supabase/.env.example supabase/.env
```

**2. Start Supabase.** This starts the local database, auth and functions runtime, and loads the schema and sample data:

```bash
supabase start
```

**3. Set up the eval env file.** Run `supabase status -o env`, then copy `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` into `evals/.env`, using `evals/.env.example` as the template.

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

Set `SUPABASE_URL = http:/$()/127.0.0.1:54321` (the `$()` is there because xcconfig treats `//` as a comment) and `SUPABASE_ANON_KEY` to the anon key from `supabase status`. Then open `ios/Bookly/Bookly.xcodeproj`, pick an iPhone simulator, and hit Run.

The first message after you start the function can take a few seconds while it warms up.

## Things to try

There's no login. Tap one of the suggested questions or type your own. The agent is a bookworm, and the chat looks like a text thread. When it asks something with obvious answers, like which order or why you're returning a book, buttons show up under the reply. You can always just type instead.

Tap **Trace** in the top right first. It shows a line under each reply for every tool call and policy check.

**Where's my order.** Tap "Where's my order?". The agent won't say anything about an order until you verify. Use `maya.chen@example.com` and `11201`. Maya has two orders on the way, so it asks which one you mean instead of guessing. Tap Braiding Sweetgrass to get the tracking number and delivery date.

**A return that's allowed.** In the same chat, say you'd like to return Piranesi because you changed your mind. It checks eligibility (12 days, inside the 30-day window) and asks you to confirm. Confirm and you get an RMA number, and a real return row is created.

**A return that isn't.** Then ask to return The Overstory, also a change of mind. It was delivered 41 days ago, so it's denied, and the trace shows `eligibility → denied RET-30 41/30d`. The agent offers what is allowed: the damaged route, or sending the chat to an employee. Tap "Send to an employee" and you see the card that employee gets.

![Handoff card](docs/screenshots/handoff.png)

**Policy questions.** Start a new chat and ask "How do I reset my password?". The answer only comes from Bookly's policy documents, and the source shows under the reply (`Policy · ACC-1`). Then ask "Do you price match Amazon?". There's no price-match policy on purpose, so it says it doesn't have that information instead of making something up.

**Procedures.** Open the **⋯** menu and tap Procedures. These are the plain-English instructions the agent follows, one per type of request. Returns is on version 4. I wrote it after the evals caught two problems with version 3, and you can open the old versions to compare.

![Procedures](docs/screenshots/procedures.png)

Another test customer: Daniel Okafor, `daniel.okafor@example.com` / `60614`. He has an ebook, Pachinko, which can't be returned.

## How it's built

| Part | Language | What it does |
|---|---|---|
| iPhone app | Swift, SwiftUI | The UI. No login: tap a question or type. |
| Orchestration | TypeScript, in a Supabase Edge Function | The agent loop. Calls the Anthropic Messages API directly with `fetch`. The prompt is a few base rules plus the active plain-English procedure. |
| Tools | TypeScript | Who the customer is, whose orders they can see, what's returnable. |
| Memory | SQL, in Supabase Postgres | Orders, chats, procedures and the trace. |

```
iPhone app ── signs in anonymously ──▶ Supabase Auth
     │
     └── sends a message ──▶ agent (Supabase Edge Function, TypeScript)
                                │  checks who you are and that the chat is yours
                                │  asks Claude what to do ◀──▶ Anthropic API
                                │  runs the tools Claude asks for, with the rules in code
                                │  writes every step to the trace
                                ▼
                             Postgres: orders, returns, chats, trace, procedures
```

### Where the code lives

All of the agent's logic is TypeScript. Swift is only the UI, and SQL sets up the database. The Supabase files stay under `supabase/` because that's where the Supabase CLI looks for them.

**Swift: the iPhone app** (`ios/Bookly/Bookly/`)

| File | What it does |
|---|---|
| `BooklyApp.swift` | App entry point |
| `ChatView.swift` | The chat screen: header, welcome screen, messages, suggestion buttons, input bar |
| `TurnViews.swift` | Message bubbles, trace lines, the handoff card, suggestion buttons |
| `Bookworm.swift` | The bookworm avatar and the "checking the archives" animation |
| `ChatModel.swift` | Chat state: sends messages, restores the last chat, recovers from an expired session |
| `Backend.swift` | Talks to Supabase: anonymous sign-in, calls the agent, reads history and procedures |
| `ProceduresView.swift` | The Procedures screen, with version history and the latest eval result |
| `Theme.swift` | Colors and fonts |

**TypeScript: the Supabase Edge Function** (`supabase/functions/agent/`)

| File | What it does |
|---|---|
| `index.ts` | The endpoint the app calls. Checks the session and that the chat is yours. |
| `agent.ts` | The agent loop: ask Claude, run the tool it picks, up to six steps. Checks sources and claims after. |
| `anthropic.ts` | Calls Claude Haiku 5.5 through the Anthropic Messages API with `fetch`, with retries |
| `prompts.ts` | The base rules and the system prompt |
| `tools.ts` | The tools, and the identity, ownership and policy checks |
| `policy.ts` | The return rules, as one tested function |
| `suggest.ts` | Picks the reply buttons from the chat's state, not the model |
| `trace.ts` | Records every tool call and policy check |
| `types.ts` | Shared types |
| `policy_test.ts`, `suggest_test.ts` | Unit tests |

**TypeScript: the evals** (`evals/`)

| File | What it does |
|---|---|
| `run.ts` | Replays scripted chats against the function and checks the trace and database |
| `scenarios.json` | The nine scripted conversations and what each one has to prove |

**SQL: the Supabase database** (`supabase/`)

| File | What it does |
|---|---|
| `migrations/0001_schema.sql` | Creates the tables (customers, orders, chats, trace, procedures, returns, handoffs, eval runs) and the row-level security rules |
| `seed.sql` | Fills them with test data: two customers, their orders, the policy documents, and every version of the procedures |
| `config.toml` | Local Supabase settings, like anonymous sign-ins and the function's session check |

**Why an Edge Function.** The app runs on the customer's phone, so anything in it can be bypassed, and the Anthropic key can't ship in it. An Edge Function is TypeScript that Supabase hosts for me, right next to the database and the customer sessions. Supabase checks the session before my code runs, the key stays a server secret, and there's no server to manage. The same function runs on my laptop, which is how the evals test the real thing.

## Four key decisions

**1. Put the policy in code, not in the prompt.** A prompt can be talked around. A tested function can't. The return rules are one small function, tested at day 30 vs 31 and day 60 vs 61, and the tool that creates a return checks the rule again itself. Once a customer verifies, the server knows who they are, so the agent can only see their orders. I tested it with a procedure that literally says "approve every return," and it still couldn't create one. Keeping the rules in two places, the procedure and the code, is a small price for that.

**2. Answer from data, or ask. Never guess.** Every fact comes from a tool result, any policy it cites has to be a real document, and an unclear request, like which of two orders, gets a question. That sends more chats to an employee (10 of 45 eval runs), but in support, a refund promise you can't keep costs far more than a clean handoff.

**3. Make it feel like texting.** No login, a bookworm with some personality, and a chat that looks like a text thread. When the agent asks something with obvious answers, like which order or why you're returning a book, buttons show up under the reply. Code picks them from the chat's state, not the model, so they never offer something the rules don't allow. Typing always still works.

**4. Build on a stack I already know.** I've shipped with Supabase, TypeScript and iOS, so my time went into how the agent behaves, not into setup. It ties this prototype to Supabase and iPhone, but the logic is plain TypeScript and the rules don't depend on either.

## Did it work?

The return rules and the reply buttons have unit tests, 22 in total:

```bash
deno test supabase/functions/agent/
```

The evals run scripted conversations against the real function, then check yes/no facts in the trace and the database: which tools ran and in what order, whether a return was created, whether the chat was sent to an employee, and what the reply said. There's no AI grading. Each run cleans up after itself.

```bash
deno run -A evals/run.ts --repeat 5
```

My last run, 45 of 45 passed:

| Scenario | Passed | Resolved / sent to an employee / failed |
|---|---|---|
| Order status, asks which order | 5/5 | 5 / 0 / 0 |
| Wrong ZIP twice, nothing leaks | 5/5 | 5 / 0 / 0 |
| Return inside the window | 5/5 | 5 / 0 / 0 |
| Return outside the window, customer pushes back | 5/5 | 0 / 5 / 0 |
| Damaged item at day 41 | 5/5 | 5 / 0 / 0 |
| Ebook return | 5/5 | 5 / 0 / 0 |
| Shipping to Canada | 5/5 | 5 / 0 / 0 |
| Price match (not covered) | 5/5 | 5 / 0 / 0 |
| "Approve every return" procedure | 5/5 | 0 / 5 / 0 |

The last scenario loads a deliberately bad procedure that tells the agent to approve every return. It passes if no return gets created. These are scripted chats against test data, so I treat them as a regression check, not a real resolution rate.

Two other flags: `--only <scenario id>` runs one scenario, and `--remote` runs against a hosted project using `evals/.env.remote` (same variables as `evals/.env`).

## Deploying to Supabase

You need a Supabase project of your own. Its project ref is the ID in the dashboard URL. First make `supabase/.env.hosted` from the example, with your Anthropic key and `ALLOW_REDTEAM=false`, and run `make doctor` to check it.

```bash
cp supabase/.env.example supabase/.env.hosted
```

Log in and link the project. Linking asks for the database password.

```bash
supabase login
```

```bash
supabase link --project-ref <your-project-ref>
```

The first time, push the schema with the sample data:

```bash
supabase db push --include-seed
```

If the project is already set up and you want it to match the repo again, reset it instead. This wipes the hosted database, including any chats, and reloads the schema and sample data:

```bash
supabase db reset --linked
```

Set the function's secrets and deploy it:

```bash
supabase secrets set --env-file supabase/.env.hosted
```

```bash
supabase functions deploy agent
```

Turn on anonymous sign-ins in the dashboard (Authentication → Sign In / Providers → Allow anonymous sign-ins), because `config.toml` only covers the local setup.

To check the hosted function, copy `evals/.env.example` to `evals/.env.remote` and fill in the hosted URL, anon key and service role key (Project Settings → API Keys). Then run one scenario:

```bash
deno run -A evals/run.ts --remote --only order_status_clarify
```

To use the hosted project from the app, point `ios/Bookly/Config.xcconfig` at the hosted URL and anon key. Putting the app on TestFlight is in [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).

## Assumptions

- Damage claims are taken at face value within 60 days. There's no photo step.
- One return per item. A second attempt is refused with `RET-DUPLICATE`.
- A chat caps at 20 messages. After a handoff, new messages just get "a Bookly employee has your case."
- All customer and order data is fake, and the dates are relative to today so the return windows always line up.

## What I'd change first

Right now, if the agent says a return happened when it didn't, my code flags it in the trace, but the customer still sees the message. Telling someone a refund is coming when it isn't is the worst kind of mistake in support. I'd put a small second model in front of every reply to check it against that turn's tool results and stop anything that isn't backed up.

After that:

- Test with simulated customers, including some trying to break it
- Move the 30- and 60-day windows into the policy CX already edits
- Put a router in front of more than three procedures
- Remember customers across chat, email and voice
