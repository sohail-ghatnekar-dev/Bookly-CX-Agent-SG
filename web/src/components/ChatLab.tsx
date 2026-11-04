// The test phone with its log beside it: chat as a customer, and watch every step the agent takes.
import { useState } from "react";
import type { ChatReply } from "../lib/api";
import { LiveLog } from "./ConversationLog";
import { PhoneChat } from "./PhoneChat";

export function ChatLab({ testing, onReply }: {
  testing?: { name: string; version: number };
  onReply?: (reply: ChatReply) => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  return (
    <div className="chat-lab">
      <PhoneChat
        testing={testing}
        onNewConversation={() => setConversationId(null)}
        onReply={(r) => {
          setConversationId(r.conversation_id);
          setRefresh((n) => n + 1);
          onReply?.(r);
        }}
      />
      <LiveLog id={conversationId} refresh={refresh} />
    </div>
  );
}
