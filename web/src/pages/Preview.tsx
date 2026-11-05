// Preview: chat with the agent as a customer would, on the Bookly app's chat screen, with every step it takes beside it.
// Live AOPs by default, or one draft in place of its live version. Chat only in this demo.
import { useEffect, useState } from "react";
import { ChatLab } from "../components/ChatLab";
import { EmailPreview, VoicePreview } from "../components/ChannelPreviews";
import { Info } from "../components/Info";
import { TestCustomers } from "../components/TestCustomers";
import { api, type Version } from "../lib/api";
import { aopTitle } from "../lib/format";
import { go } from "../lib/router";

const CHANNELS = ["Chat", "Email", "Voice", "Decagon Assist"] as const;
type Channel = (typeof CHANNELS)[number];

export function PreviewPage({ testing }: { testing?: { name: string; version: number } }) {
  const [drafts, setDrafts] = useState<Version[]>([]);
  const [channel, setChannel] = useState<Channel>("Chat");

  useEffect(() => {
    api.overview().then((o) => setDrafts(o.versions.filter((v) => !v.published_at))).catch(() => {});
  }, []);

  const current = testing ? drafts.find((d) => d.name === testing.name && d.version === testing.version) : undefined;
  const label = testing ? `${current?.title ?? aopTitle(testing.name)} draft v${testing.version}` : "Live AOPs";

  return (
    <div className="page">
      <div className="page-head">
        <h1>Preview</h1>
        <Info text="Talk to the agent exactly as customers will, and see every step it takes and why." />
      </div>
      <div className="tabs" role="tablist">
        {CHANNELS.map((c) => (
          <button key={c} role="tab" className={`tab${c === channel ? " active" : ""}`} aria-selected={c === channel}
            disabled={c === "Decagon Assist"} title={c === "Decagon Assist" ? "Not part of this demo" : undefined} onClick={() => setChannel(c)}>{c}</button>
        ))}
      </div>
      {channel === "Voice" && <VoicePreview />}
      {channel === "Email" && <EmailPreview />}
      <div className="card preview-card" hidden={channel !== "Chat"}>
        <div className="card-head" style={{ marginBottom: 0 }}>
          <h2>Test chat</h2>
          <span className={`pill ${testing ? "draft" : "ok"}`}>{label}</span>
          <span className="spacer" />
          <label className="row small muted">
            AOP versions
            <select
              className="select"
              value={testing ? `${testing.name}:${testing.version}` : ""}
              onChange={(e) => {
                const [name, v] = e.target.value.split(":");
                go(name ? `#/preview?aop=${name}&v=${v}` : "#/preview");
              }}
            >
              <option value="">Live AOPs</option>
              {drafts.map((d) => (
                <option key={`${d.name}:${d.version}`} value={`${d.name}:${d.version}`}>{d.title ?? aopTitle(d.name)} draft v{d.version}, rest live</option>
              ))}
              {testing && !current && <option value={`${testing.name}:${testing.version}`}>{label}</option>}
            </select>
          </label>
        </div>
        <ChatLab testing={testing} />
      </div>
      {channel === "Chat" && <TestCustomers />}
    </div>
  );
}
