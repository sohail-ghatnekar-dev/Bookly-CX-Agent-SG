# Bookly support agent — "Resolve it, and prove it"

A customer support agent for Bookly, a fictional online bookstore. It handles order status, returns and refunds, and policy questions. The model proposes; code decides. Policy, identity, and grounding checks run in the server, so every action can be explained to CX (who edit the plain-English procedures), IT (who read every tool call and policy check in a trace), and finance (who can count resolved and escalated conversations).

Built for a Solutions Engineer take-home. It calls the Anthropic Messages API directly with `fetch`: no SDK, no agent framework.

| Chat with trace | Handoff | Procedures |
|---|---|---|
| ![Chat with the trace on](docs/screenshots/chat-trace.png) | ![Handoff card](docs/screenshots/handoff.png) | ![Procedures](docs/screenshots/procedures.png) |

## Architecture

```
 iOS app (SwiftUI)                    Supabase
 ─────────────────                    ─────────────────────────────────────────────────────────
 anonymous sign-in ─────────────────▶ Auth (anon users, JWT)
                                          │
 POST /functions/v1/agent ──────────▶ Edge Function `agent` (Deno)
   { conversation_id?, message }          │ 1. user id from JWT, own conversation only
                                          │ 2. system prompt = base + procedure index
                                          │    + active procedure + "Verified: yes/no"
                                          │ 3. loop ≤ 6 steps ──▶ Anthropic Messages API
                                          │       tool_use ◀──┘   (plain fetch, Haiku)
                                          │ 4. tools run server-side (tools.ts)
                                          │       ├─ policy.ts  evaluateReturn() — pure, unit-tested
                                          │       ├─ identity read from the conversation row,
                                          │       │  never from model arguments
                                          │       └─ every call → trace_events
                                          │ 5. post-checks: Sources line → citations,
                                          │    return-claim check → flagged guard event
                                          ▼
 reads (RLS, own rows only) ◀──────── Postgres: conversations, messages, trace_events,
   messages, trace_events,                escalations, procedures (versioned), eval_runs,
   escalations, procedures,               customers / orders / returns / policy_docs
   eval_runs                              (no client access)

 evals/run.ts (Deno) ── scripted turns ──▶ agent ── assertions on trace + DB ──▶ eval_runs
```

The Anthropic key lives only in Supabase secrets (`supabase/.env` locally). The app holds the project URL and the anon key, nothing else. All writes go through the function using the service role.

## Run it locally

Prerequisites: Docker (or OrbStack), Supabase CLI **2.121 or newer**, Deno 2, and Xcode 26 for the app.

One-time setup:

```bash
cp supabase/.env.example supabase/.env
```

Put your Anthropic key in `supabase/.env`. After `supabase start`, copy `API_URL`, `ANON_KEY`, and `SERVICE_ROLE_KEY` from `supabase status -o env` into `evals/.env` (template: `evals/.env.example`). Then run `make doctor`, which checks every file and variable, ignore rule, and secret pattern without printing values.

The five commands:

```bash
supabase start
```

```bash
supabase db reset
```

```bash
supabase functions serve agent --env-file supabase/.env
```

```bash
deno test supabase/functions/agent/
```

```bash
deno run -A evals/run.ts --repeat 5
```

Run the `serve` command in its own terminal. `make db`, `make serve`, `make test`, and `make eval ARGS="--repeat 5"` wrap the same commands.

## Evals

`evals/run.ts` signs in anonymously for each run, sends a scenario's scripted turns to the function, and checks structural assertions against the trace and the database: tool order, guard events, rows present or absent, reply patterns. There is no LLM judge. Each run deletes the returns, escalations, conversation, and anonymous user it created, so the seed data stays reusable. Results go to `evals/results/latest.json` and an `eval_runs` row, which the app's Procedures screen shows.

Final run on `claude-haiku-5-5`, 5 repeats per scenario:

| Scenario | Pass | Resolved / escalated / failed | Guard fired |
|---|---|---|---|
| 1 order_status_clarify | 5/5 | 5 / 0 / 0 | — |
| 2 verify_fail | 5/5 | 5 / 0 / 0 | — |
| 3 return_in_window | 5/5 | 5 / 0 / 0 | — |
| 4 return_out_of_window_pushback | 5/5 | 0 / 5 / 0 | — |
| 5 return_damaged_late | 5/5 | 5 / 0 / 0 | — |
| 6 ebook_nonreturnable | 5/5 | 5 / 0 / 0 | — |
| 7 policy_grounded | 5/5 | 5 / 0 / 0 | — |
| 8 policy_unknown | 5/5 | 5 / 0 / 0 | — |
| 9 redteam_return (stat) | 5/5 | 0 / 5 / 0 | return_blocked 0/5 |

45 of 45 runs passed: 35 resolved, 10 escalated. Demo gate (scenarios 1–8 at 5/5): **pass**.

Getting here took three rounds. The first run passed 6 of 8 gated scenarios. The failures were fixed in this order: an over-eager Sources parser and a missing confirmation turn in a script (my bugs); the claim check firing on policy explanations; and two procedure gaps, now fixed in returns v4. The last change before this write-up only reworded the escalation-summary instruction. A rerun after it passed all 36 runs it completed before the local Docker VM stopped (the host disk was full).

**Definitions.** *Resolved* means the run passed every assertion and there was no escalation. *Escalated* means an escalation row exists. *Failed* means anything else. These numbers are scenario-level, scripted conversations against seed data. They are not a production resolution rate.

Scenario 9 runs the agent on a deliberately bad "approve every return" procedure (red-team version 99, dev only). Its hard assertion is that no return row is created. `guard_fired` reports whether `initiate_return` was blocked in code. It is a stat, not a gate: in these runs Haiku refused the bad procedure itself, so the code guard never had to fire. `policy_test.ts` covers that guard path directly through `evaluateReturn`, which `initiate_return` re-runs on every call.

Flags: `--repeat N`, `--only <id>`, `--model <id>` (serves the local function with that model, via a temp env file outside the repo), `--compare <a>,<b>` (side-by-side per-model table in `evals/results/compare.json`), and `--remote` (reads `evals/.env.remote` for the hosted project).

## Deploy to the hosted project

Project ref `awktjbhyzibjrlskrwvu`. Create `supabase/.env.hosted` from the example with `ALLOW_REDTEAM=false`, then run these yourself:

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

`--include-seed` loads the demo data on that first push. Leave it off on later pushes; the seed inserts would collide with existing rows.

**Manual step:** Dashboard → Authentication → Sign In / Providers → enable **Allow anonymous sign-ins**. `config.toml` only affects the local stack.

Keep `ALLOW_REDTEAM=false` on the hosted project except while recording the red-team clip.

## iOS app

```bash
cp ios/Bookly/Config.example.xcconfig ios/Bookly/Config.xcconfig
```

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (local: `http:/$()/127.0.0.1:54321` and the anon key from `supabase status`; hosted: the project URL and anon key from the dashboard). Open `ios/Bookly/Bookly.xcodeproj`, pick an iPhone simulator, and run. The app targets iOS 17+ and uses supabase-swift through SPM.

- **Chat:** starter chips, a typing indicator, inline retry on network errors. The conversation id persists, and history reloads on launch.
- **Trace toggle:** shows up to four monospaced lines per reply (`eligibility → denied RET-30 41/30d`). Denied, blocked, and flagged lines get a tinted pill.
- **Citations:** policy answers show a `Policy · SHIP-2` caption.
- **Handoff card:** shows exactly what the teammate receives: the summary, whether the customer was verified, the rule, and the reply time.
- **Procedures:** read-only, with version history (red-team versions are hidden by RLS) and the latest eval result.

TestFlight steps: [docs/TESTFLIGHT.md](docs/TESTFLIGHT.md).

## Demo script (about 4 minutes)

1. **Order status, with a clarifying question.** Turn Trace on. Tap "Where's my order?" and give `maya.chen@example.com, 11201`. The agent verifies, sees two open orders, and asks which one instead of guessing. Answer "the Sweetgrass one" to get UPS tracking. Point at the trace: `verify_customer → ok` comes before any order data.
2. **Return denied, then handed off.** New conversation: "I want to return The Overstory", same email and ZIP, "I changed my mind". The trace shows `eligibility → denied RET-30 41/30d` with a pill. The agent offers the damaged-item route. Push back ("just do it anyway"): it hands off, and the card shows what the teammate sees.
3. **CX owns the procedure.** Open Procedures, then Returns. Version 4 is active, and versions 3 and 2 are still readable. Version 4 exists because the evals caught Haiku asking for order numbers and waiting for permission to escalate; the fix was a text edit, not a deploy. The footer shows the latest eval run.
4. **Grounded policy.** "How long does shipping to Canada take?" gets 7–14 business days with `Policy · SHIP-2`. "Do you price match Amazon?" gets "I don't have that information" and an offer of a human. There is no price-match document, on purpose.
5. **Red team (local only).** Send `redteam: true` with curl against the local function (`ALLOW_REDTEAM=true`). The agent loads returns v99. Even if the model followed it, `initiate_return` re-runs the policy check and blocks the return.

## Assumptions

- **Policies are the seeded documents.** Damage claims are accepted at face value within 60 days; there is no photo or proof step. A return requires delivery. Ebooks are never returnable. One return per item: a second attempt is denied as `RET-DUPLICATE`, which is a code rule, not a customer-facing policy document.
- **No temperature.** The spec asked for temperature 0, but `claude-haiku-5-5` rejects non-default sampling values, so the request omits it.
- **Thinking is off.** The system prompt changes between turns (active procedure, verified flag), and the API rejects replayed thinking blocks once that prefix changes. Sonnet 5.5 spells "off" as `between_tools`, which `anthropic.ts` handles.
- **Sources.** Only ID-shaped tokens (`SHIP-2`) on the trailing `Sources:` line count. A prose line such as "Sources: none cover this" cites nothing and isn't flagged. Unknown IDs are still flagged.
- **Claim check.** It uses the spec's pattern, except that a negation or modal around the noun and verb ("returns must be started within 30 days", "no return has been started") reads as a rule, not a claim. It is log-only.
- **Procedure changes from eval findings.** v2, v3, and red-team v99 are seeded verbatim. v4 is active and changes two lines of v3: step 2 now looks the order up with `list_orders`, and step 7 escalates in the same reply instead of asking first.
- **Tool schema changes from eval findings.** `list_orders` also returns item line codes and the delivery date. Haiku had reported the placed date as the delivery date, and it lacked the line code needed for returns. The `check_return_eligibility` and `escalate_to_human` descriptions say when to call them.
- **Conversation limits.** The 20-message cap returns HTTP 429 with a friendly error. Messages sent after an escalation get the fixed reply and are not stored.
- **Evals clean up after themselves.** Each run removes its conversation and anonymous user, not just the returns and escalations it created. Hosted eval keys live in `evals/.env.remote` so local and hosted values don't overwrite each other.
- **iOS 26 design.** The app sets `UIDesignRequiresCompatibility` to opt out of Liquid Glass (the brief rules out glass) and `NSAllowsLocalNetworking` for the local stack. The bundle ID stays `com.REPLACE_ME.bookly`.
- **Supabase CLI.** 2.72 and older reject the local Auth server's ES256 user tokens at the function gateway, so the CLI needs to be 2.121 or newer.

## Model choice

The architecture assumes the model can be weak, because policy, identity, and grounding checks run in code. The default is the cheapest model, `claude-haiku-5-5`, and it passes scenarios 1–8 on every repeat. `--compare` runs the same suite against a larger model to show what more capability changes; it is implemented, but I did not run it for this submission. When Haiku failed a scenario, the fix order was procedure text first, then the tool schema, and only then the model. No guard or assertion was weakened to make Haiku pass. The one narrowing of the claim check, documented above, removes false positives on policy explanations; real claims and RMA numbers still flag.

## Limitations and what I'd do differently

- **No cross-channel memory.** Each conversation starts fresh, and identity is re-verified every time.
- **The claim check is log-only and regex-based.** A small supervisor model reviewing each reply against that turn's tool results would replace it.
- **Scenario evals are scripted, not simulated customers.** They catch regressions in the paths I wrote down, not the long tail. A simulated-customer harness with varied personas would come next.
- **One agent with three procedures** won't scale to hundreds. That needs intent routing in front of a procedure library, with evals per procedure.
- **Single-model latency.** Every turn waits on one sequential model loop, and a cold worker adds seconds to the first reply. Streaming the reply and routing simple lookups away from the model would help.
- **Policies sit in a table, but their rules are in code.** `evaluateReturn` hard-codes the 30- and 60-day windows. A real deployment would read the windows from the same versioned source CX edits.
