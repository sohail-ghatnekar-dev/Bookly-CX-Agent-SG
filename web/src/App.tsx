// The Bookly workspace in an agent platform admin: sign-in, then Build (AOPs, tools), Analyze (Insights, Watchtowers),
// Conversations, Versioning and Preview.
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useRoute } from "./lib/router";
import { supabase } from "./lib/supabase";
import { AopDetailPage } from "./pages/AopDetail";
import { AopListPage } from "./pages/AopList";
import { ConversationsPage } from "./pages/Conversations";
import { HomePage } from "./pages/Home";
import { InsightsPage } from "./pages/Insights";
import { LoginPage } from "./pages/Login";
import { PreviewPage } from "./pages/Preview";
import { TestSetsPage } from "./pages/TestSets";
import { ToolsPage } from "./pages/Tools";
import { VersioningPage } from "./pages/Versioning";
import { WatchtowersPage } from "./pages/Watchtowers";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const route = useRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <LoginPage />;

  const [section = "home", page = "", id] = route.path;
  const isAdmin = session.user.app_metadata?.role === "admin";

  return (
    <div className="shell">
      <Sidebar section={section} page={page} email={session.user.email ?? ""} onSignOut={() => supabase.auth.signOut()} />
      <main className="main">
        {!isAdmin ? (
          <div className="empty">This account isn't a Bookly admin, so it can't open the workspace.</div>
        ) : (
          <Page section={section} page={page} id={id} query={route.query} />
        )}
      </main>
    </div>
  );
}

function Page({ section, page, id, query }: { section: string; page: string; id?: string; query: URLSearchParams }) {
  if (section === "home") return <HomePage />;
  if (section === "test") return <TestSetsPage key={id ?? ""} name={page === "sets" ? id : undefined} />;
  if (section === "build" && page === "aops") {
    const from = query.get("from") ?? undefined;
    return id ? <AopDetailPage key={`${id}:${from}`} name={id} suggestion={from} /> : <AopListPage />;
  }
  if (section === "build" && page === "tools") return <ToolsPage />;
  if (section === "analyze" && page === "insights") return <InsightsPage />;
  if (section === "analyze" && page === "watchtowers") return <WatchtowersPage initial={query.get("tower") ?? undefined} />;
  if (section === "conversations") return <ConversationsPage />;
  if (section === "versioning") return <VersioningPage />;
  if (section === "preview") {
    const aop = query.get("aop");
    const v = Number(query.get("v"));
    return <PreviewPage key={`${aop}:${v}`} testing={aop && v ? { name: aop, version: v } : undefined} />;
  }
  return <HomePage />;
}
