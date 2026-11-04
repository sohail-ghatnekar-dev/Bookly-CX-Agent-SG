// POST /agent { conversation_id?, message, redteam? } → { reply, citations, suggestions, trace, … }
import { createClient } from "npm:@supabase/supabase-js@2";
import { AnthropicError } from "./anthropic.ts";
import { handleMessage } from "./handle.ts";

const MAX_MESSAGE_CHARS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The gateway verifies the JWT (verify_jwt = true); this resolves it to a user id.
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const userId = auth.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `message must be 1-${MAX_MESSAGE_CHARS} characters` }, 400);
  }
  const conversationId = body?.conversation_id;
  if (conversationId !== undefined && conversationId !== null && !UUID.test(String(conversationId))) {
    return json({ error: "conversation_id must be a UUID" }, 400);
  }

  try {
    const redteam = body?.redteam === true && Deno.env.get("ALLOW_REDTEAM") === "true";
    const out = await handleMessage(db, userId, conversationId, message, { redteam });
    return out.ok ? json(out.body) : json({ error: out.error }, out.status);
  } catch (err) {
    console.error("agent error:", err instanceof Error ? err.message : err);
    if (err instanceof AnthropicError) return json({ error: "The assistant is unavailable. Try again." }, 502);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
