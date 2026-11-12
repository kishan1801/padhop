"use client";

import { FormEvent, useState, useRef, useEffect } from "react";
import { Send, Plane } from "lucide-react";
import { AppShell } from "@/components/app-shell";

type Message = { role: "user" | "assistant"; content: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! Ask me about helicopter charters near you — like \"what's available near Bengaluru right now?\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage.content }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't reach the assistant right now." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell><main className="dashPage assistantPage">
      <div className="dashHeader">
        <p className="eyebrow">Flight concierge</p>
        <h1>Plan with confidence</h1>
        <p>Ask about nearby helipads, current availability, or flight-weather conditions.</p>
      </div>

      <div className="chatWindow">
        {messages.map((m, i) => (
          <div key={i} className={`chatBubble ${m.role}`}>
            {m.role === "assistant" && (
              <div className="chatIcon">
                <Plane size={14} />
              </div>
            )}
            <div className="chatText">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chatBubble assistant">
            <div className="chatIcon">
              <Plane size={14} />
            </div>
            <div className="chatText typing">Thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="chatInputForm">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What's available near Bengaluru right now?"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </main></AppShell>
  );
}
