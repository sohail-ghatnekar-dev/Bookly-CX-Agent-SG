// The console talks to the same Supabase project as the app, with the public anon key only.
// Admin rights come from the signed-in user's role, checked by the console function on every call.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (!url || !anonKey) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env.local (see .env.example).");

export const supabase = createClient(url, anonKey);
