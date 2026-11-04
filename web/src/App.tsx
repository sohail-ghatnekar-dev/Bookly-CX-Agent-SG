// The AOP console: the implementer's side of the Bookly story. Sign-in, then Build/Test/Publish and Watchtower.
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { AopsPage } from "./pages/Aops";
import { AuditPage } from "./pages/Audit";
import { LoginPage } from "./pages/Login";
import { WatchtowerPage } from "./pages/Watchtower";

type Page = "aops" | "watchtower" | "audit";

const NAV: { id: Page; label: string; hint: string }[] = [
  { id: "aops", label: "AOPs", hint: "Build, test, publish" },
  { id: "watchtower", label: "Watchtower", hint: "Logs and guardrails" },
  { id: "audit", label: "Audit log", hint: "Every change, by whom" },
];

function pageFromHash(): Page {
  const id = window.location.hash.replace("#", "");
  return NAV.some((n) => n.id === id) ? (id as Page) : "aops";
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [page, setPage] = useState<Page>(pageFromHash);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  if (session === undefined) return null;
  if (!session) return <LoginPage />;

  const isAdmin = session.user.app_metadata?.role === "admin";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <div>
            <div className="brand-name">Bookly</div>
            <div className="brand-sub">AOP console · Decagon</div>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} className={`nav-item${page === n.id ? " active" : ""}`}>
              <span className="nav-label">{n.label}</span>
              <span className="nav-hint">{n.hint}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">{session.user.email}</div>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {!isAdmin ? (
          <div className="empty">This account isn't a Bookly admin, so it can't open the console.</div>
        ) : page === "aops" ? (
          <AopsPage />
        ) : page === "watchtower" ? (
          <WatchtowerPage />
        ) : (
          <AuditPage />
        )}
      </main>
    </div>
  );
}
