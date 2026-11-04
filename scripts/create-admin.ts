// Creates (or updates) a console admin: an email + password user with app_metadata.role = "admin".
// deno run -A scripts/create-admin.ts [--remote]
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from evals/.env (local) or evals/.env.remote (cloud).
// Asks for the email and password, or reads ADMIN_EMAIL and ADMIN_PASSWORD from the environment.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";
import { createClient } from "npm:@supabase/supabase-js@2";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { boolean: ["remote"] });
const envFile = `${ROOT}evals/${args.remote ? ".env.remote" : ".env"}`;
const env = Object.fromEntries(
  Deno.readTextFileSync(envFile).split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter((m) => m !== null).map((m) => [m![1], m![2]]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const email = (Deno.env.get("ADMIN_EMAIL") ?? prompt("Admin email:") ?? "").trim().toLowerCase();
const password = Deno.env.get("ADMIN_PASSWORD") ?? prompt("Password (at least 12 characters):") ?? "";
if (!email.includes("@") || password.length < 12) {
  console.error("Need an email and a password of at least 12 characters.");
  Deno.exit(1);
}

const attrs = { password, email_confirm: true, app_metadata: { role: "admin" } };
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
const existing = list?.users.find((u) => u.email === email);
const { error } = existing
  ? await db.auth.admin.updateUserById(existing.id, attrs)
  : await db.auth.admin.createUser({ email, ...attrs });
if (error) {
  console.error(`Could not save the admin: ${error.message}`);
  Deno.exit(1);
}
console.log(`${existing ? "Updated" : "Created"} admin ${email} on ${env.SUPABASE_URL}`);
