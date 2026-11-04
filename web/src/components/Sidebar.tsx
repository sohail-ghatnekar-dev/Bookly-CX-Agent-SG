// The left nav, laid out like Decagon's: the workspace, then every section. Build, Analyze, Conversations, Versioning
// and Preview open pages in this demo; the rest are shown for the full picture and don't navigate.
import { useEffect, useState } from "react";
import { Bookworm } from "./Bookworm";
import { Icon } from "./Icon";

interface Item {
  id: string;
  label: string;
  icon: string;
  href?: string;
  children?: { id: string; label: string; href: string }[];
}

const NAV: Item[] = [
  { id: "home", label: "Home", icon: "home", href: "#/home" },
  { id: "autopilot", label: "Autopilot", icon: "autopilot" },
  { id: "conversations", label: "Conversations", icon: "conversations", href: "#/conversations" },
  { id: "outbound", label: "Outbound", icon: "outbound" },
  {
    id: "analyze",
    label: "Analyze",
    icon: "analyze",
    children: [
      { id: "insights", label: "Insights", href: "#/analyze/insights" },
      { id: "watchtowers", label: "Watchtowers", href: "#/analyze/watchtowers" },
    ],
  },
  {
    id: "build",
    label: "Build",
    icon: "build",
    children: [
      { id: "aops", label: "AOPs", href: "#/build/aops" },
      { id: "tools", label: "Tools", href: "#/build/tools" },
    ],
  },
  { id: "qa", label: "QA", icon: "qa", children: [] },
  { id: "versioning", label: "Versioning", icon: "versioning", href: "#/versioning" },
  { id: "test", label: "Test", icon: "test", children: [{ id: "sets", label: "Test sets", href: "#/test/sets" }] },
  { id: "preview", label: "Preview", icon: "preview", href: "#/preview" },
  { id: "settings", label: "Settings", icon: "settings", children: [] },
];

export function Sidebar({ section, page, email, onSignOut }: {
  section: string;
  page: string;
  email: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ build: true, analyze: true, test: true });
  // Arriving in a section from anywhere (a Home suggestion, a link) opens it, so the current page shows highlighted.
  useEffect(() => {
    setOpen((o) => (o[section] ? o : { ...o, [section]: true }));
  }, [section, page]);

  return (
    <aside className="sidebar">
      <div className="rail-top">
        <span className="logo-d" aria-label="Agent platform">D</span>
        <span className="icons"><Icon name="search" /><Icon name="pin" /></span>
      </div>
      <div className="workspace" title="Workspace">
        <Bookworm size={22} />
        <span>Bookly</span>
        <span className="chev"><Icon name="down" size={14} /></span>
      </div>
      <nav className="nav">
        {NAV.map((item) => {
          const hasKids = item.children !== undefined;
          const live = !!item.href || !!item.children?.length;
          const active = item.id === section && !hasKids;
          return (
            <div key={item.id}>
              {item.href ? (
                <a className={`nav-item${active ? " active" : ""}`} href={item.href}>
                  <Icon name={item.icon} />{item.label}
                </a>
              ) : (
                <button
                  className={`nav-item${live ? "" : " off"}`}
                  title={live ? undefined : "Not part of this demo"}
                  aria-expanded={hasKids && live ? !!open[item.id] : undefined}
                  onClick={() => live && setOpen((o) => ({ ...o, [item.id]: !o[item.id] }))}
                >
                  <Icon name={item.icon} />{item.label}
                  {hasKids && <span className={`chev${open[item.id] && live ? " open" : ""}`}><Icon name="chevron" size={14} /></span>}
                </button>
              )}
              {hasKids && live && open[item.id] && (
                <div className="nav-sub">
                  {item.children!.map((c) => (
                    <a key={c.id} className={`nav-item${section === item.id && page === c.id ? " active" : ""}`} href={c.href}>{c.label}</a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="rail-foot">
        <div className="who">{email}</div>
        <button className="link small" onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}
