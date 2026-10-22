# Bookly support agent

This is my take-home for the Solutions Engineer role. Bookly is a made-up online bookstore, and this is its support agent. It can tell you where an order is, start a return (or say no to one), and answer questions about shipping, refunds and accounts.

## The idea: resolve it, and prove it

A good support agent doesn't just answer questions. It fixes the problem, and you can see how it got there.

So I put deterministic checks first. The model suggests the next step, but my code provides the guardrails:

- **Code decides.** The model can only ask for a tool. The TypeScript tool checks who the customer is, whose orders they can see, and whether a return is in policy before anything happens.
- **Nothing guessed.** Facts come only from tool results, any policy it cites has to exist, and an unclear request gets a question.
- **Everything audited.** Each tool call and policy check goes into a trace, with the rule that made the call.

![Chat with the trace turned on](docs/screenshots/chat-trace.png)

## Setting it up

The agent runs in the cloud: a Supabase project holds the database and the Edge Function, and the function calls Claude through the Anthropic API. Nothing has to run on your Mac except Xcode. (If you'd rather run everything locally with Docker, that's at the end.)

You need:

- An Anthropic API key
- A Supabase account (the free plan is enough)
- The Supabase CLI, 2.121 or newer (`brew install supabase/tap/supabase`)
- Deno 2, for the tests and evals (`brew install deno`)
- Xcode 26, for the iPhone app

### 1. Get a Claude API key

1. Go to [console.anthropic.com](https://console.anthropic.com) and sign in.
2. Add some credit under **Billing**.
3. Go to **API Keys**, click **Create Key**, and copy it.

The agent uses Claude Haiku 5.5 (`claude-haiku-5-5`). You can change that with `ANTHROPIC_MODEL` in the next step.

### 2. Create a Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click **New project**.
2. Give it a name, set a database password (save it, you'll need it once below), and pick a region.
3. Once it's ready, note the **project ref**. It's the ID in the dashboard URL (`/project/<project-ref>`).
4. Go to **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**, and save. Customers never log in, so the app signs them in anonymously.
5. Go to **Authentication → Rate Limits** and raise the anonymous sign-ins limit to 200 an hour. The evals sign in as a new customer on every run, and the default of 30 an hour runs out partway through.

### 3. Add your keys

Copy the example secrets file and replace `YOUR_ANTHROPIC_API_KEY_HERE` with your key. Leave `ALLOW_REDTEAM=false`.

```bash
cp supabase/.env.example supabase/.env.hosted
```

This file is git-ignored. It only ever goes to Supabase as function secrets.

Every key lives in a git-ignored file, and each one has an example on GitHub with `YOUR_..._HERE` placeholders:

| Copy this example | To | What goes in it | Where to find it |
|---|---|---|---|
| `supabase/.env.example` | `supabase/.env.hosted` | Your Anthropic API key | console.anthropic.com → API Keys |
| `ios/Bookly/Config.example.xcconfig` | `ios/Bookly/Config.xcconfig` | Your project URL and anon key (step 5) | Supabase → Project Settings → API Keys |
| `evals/.env.example` | `evals/.env.remote` | Project URL, anon key and service role key (only for the evals) | Supabase → Project Settings → API Keys |

`make doctor` (step 6) flags any value you haven't filled in yet.

### 4. Deploy

Log in and link this folder to your project. Linking asks for the database password from step 2.

```bash
supabase login
```

```bash
supabase link --project-ref <your-project-ref>
```

Create the tables and load the sample data:

```bash
supabase db push --include-seed
```

Upload the secrets and deploy the agent:

```bash
supabase secrets set --env-file supabase/.env.hosted
```

```bash
supabase functions deploy agent --use-api
```

`--use-api` builds the function on Supabase's side, so you don't need Docker.

### 5. Run the iPhone app

Copy the app's config template:

```bash
cp ios/Bookly/Config.example.xcconfig ios/Bookly/Config.xcconfig
```

Set `SUPABASE_URL = https:/$()/<your-project-ref>.supabase.co` (the `$()` is there because xcconfig files treat `//` as a comment). Set `SUPABASE_ANON_KEY` to your project's anon key, from **Project Settings → API Keys** in the dashboard, or from:

```bash
supabase projects api-keys --project-ref <your-project-ref>
```

Only the URL and the anon key go in the app, never the service role or Anthropic key.

Then open `ios/Bookly/Bookly.xcodeproj` and hit Run:

- **Simulator:** pick any iPhone simulator.
- **Your iPhone:** plug it in, turn on Developer Mode (Settings → Privacy & Security), pick your team under Signing & Capabilities, and change the bundle ID from `com.example.bookly` to one of your own. A free Apple account works.

The first message can take a few seconds while the function warms up. After that it's quick.

### 6. Check your setup

This makes sure every file and variable is in place and that nothing secret would get committed. It never prints the values.

```bash
make doctor
```

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
| Supabase Edge Function | TypeScript | The orchestration: the agent loop in `agent.ts`. Calls the Anthropic Messages API directly with `fetch`. The prompt is a few base rules plus the active plain-English procedure. |
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

**2. Answer from data, or ask. Never guess.** Every fact comes from a tool result, any policy it cites has to be a real document, and an unclear request, like which of two orders, gets a question. That sends more chats to an employee (5 of 45 eval runs), but in support, a refund promise you can't keep costs far more than a clean handoff.

**3. Make it feel like texting.** No login, a bookworm with some personality, and a chat that looks like a text thread. When the agent asks something with obvious answers, like which order or why you're returning a book, buttons show up under the reply. Code picks them from the chat's state, not the model, so they never offer something the rules don't allow. Typing always still works.

**4. Build on a stack I already know.** I've shipped with Supabase, TypeScript and iOS, so my time went into how the agent behaves, not into setup. It ties this prototype to Supabase and iPhone, but the logic is plain TypeScript and the rules don't depend on either.

## Did it work?

The return rules and the reply buttons have unit tests, 22 in total:

```bash
deno test supabase/functions/agent/
```

The evals run scripted conversations against the real function, then check yes/no facts in the trace and the database: which tools ran and in what order, whether a return was created, whether the chat was sent to an employee, and what the reply said. There's no AI grading. Each run cleans up after itself.

To run them against your cloud project, copy `evals/.env.example` to `evals/.env.remote` and fill in your project URL, anon key and service role key (Project Settings → API Keys). The service role key lets the runner check the database and clean up. Keep it out of the app and out of git. Then:

```bash
deno run -A evals/run.ts --remote --repeat 5
```

My last run, against the deployed cloud agent, 45 of 45 passed:

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
| "Approve every return" procedure | 5/5 | 5 / 0 / 0 |

The last scenario asks for a return that's out of policy, and passes if no return gets created. Run locally, it also loads a deliberately bad procedure that tells the agent to approve every return, and the return still gets blocked. The cloud keeps that test procedure switched off (`ALLOW_REDTEAM=false`), so there it just runs the normal returns procedure. These are scripted chats against test data, so I treat them as a regression check, not a real resolution rate.

Add `--only <scenario id>` to run one scenario. The latest result shows up on the app's Procedures screen.

## Resetting the demo data

A return can only be started once per item, so after a demo run, clear the chats and returns in the dashboard's **SQL Editor**:

```sql
delete from returns;
delete from escalations;
delete from conversations;
```

The customers, orders, policies, procedures and the latest eval result stay. In the app, start a new chat from the **⋯** menu.

## Running it locally instead

Everything also runs on your Mac with Docker (I used OrbStack). Keep a few GB of disk free, because the Supabase images are big.

1. Copy the secrets file, add your Anthropic key, and set `ALLOW_REDTEAM=true`. That lets the evals load the "approve every return" test procedure locally.
   ```bash
   cp supabase/.env.example supabase/.env
   ```
2. Start the local stack. This loads the schema and sample data.
   ```bash
   supabase start
   ```
3. Start the agent, and leave it running in its own terminal:
   ```bash
   supabase functions serve agent --env-file supabase/.env
   ```
4. In `ios/Bookly/Config.xcconfig`, set `SUPABASE_URL = http:/$()/127.0.0.1:54321` and the anon key from `supabase status`. That works in the simulator. On a real iPhone, use your Mac's local name instead (like `http:/$()/Your-Mac.local:54321`), keep the phone on the same Wi-Fi, and tap Allow when the app asks to find devices on your local network.
5. For the evals, copy `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY` from `supabase status -o env` into `evals/.env`, then run `deno run -A evals/run.ts --repeat 5`.

To reset the local data, run `supabase db reset`.

Putting the app on TestFlight is in [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).

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
