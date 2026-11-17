import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageCircle, Send, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [
    { title: "Program Chat | Cogni" },
    { name: "description", content: "Chat with Cogni students in your academic program." },
    { property: "og:title", content: "Program Chat | Cogni" },
    { property: "og:description", content: "Connect with students in your academic program on Cogni." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <RequireAuth><ChatPage /></RequireAuth>,
});

type Msg = { id: string; user_id: string; display_name: string; body: string; created_at: string; program: string };

function ChatPage() {
  const { user } = useAuth();
  const [program, setProgram] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("Student");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("program, display_name").eq("id", user.id).single();
      setProgram(prof?.program ?? null);
      setDisplayName(prof?.display_name ?? "Student");
      if (prof?.program) {
        const { data } = await supabase
          .from("program_messages" as any)
          .select("*")
          .eq("program", prof.program)
          .order("created_at", { ascending: true })
          .limit(200);
        setMessages((data ?? []) as any);
      }
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (!program) return;
    const channel = supabase
      .channel(`program_messages:${program}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "program_messages", filter: `program=eq.${program}` },
        (payload) => setMessages((m) => [...m, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [program]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !program || !text.trim()) return;
    setSending(true);
    const { error } = await supabase.from("program_messages" as any).insert({
      program, user_id: user.id, display_name: displayName, body: text.trim(),
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    setText("");
  }

  if (loading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (!program) return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <MessageCircle className="mx-auto h-8 w-8 text-primary" />
      <h2 className="mt-3 font-display text-xl font-semibold">Set your program first</h2>
      <p className="mt-1 text-sm text-muted-foreground">Add your degree program in your profile so we can connect you with classmates.</p>
      <Link to="/profile" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground">Go to profile</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6 text-primary" /> {program} chat</h1>
        <p className="text-sm text-muted-foreground">Message classmates in your program — ask for decks, swap notes, study together.</p>
      </div>
      <div className="rounded-2xl border border-border bg-card h-[60vh] flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">No messages yet — be the first to say hi.</p>
          ) : messages.map((m) => {
            const mine = m.user_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {!mine && <div className="text-xs font-medium opacity-70 mb-0.5">{m.display_name}</div>}
                  <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                  <div className={`text-[10px] mt-1 ${mine ? "opacity-70" : "text-muted-foreground"}`}>{formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}</div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="border-t border-border p-3 flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message your program…" maxLength={2000} />
          <Button type="submit" disabled={sending || !text.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
