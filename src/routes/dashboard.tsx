import { createFileRoute, Link } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Plus, BookOpen, Sparkles, Flame, Target, TrendingUp, Trophy, Crown, Medal, Users, Share2, Search, Loader2, MessageCircle, Trash2, ArrowRight, Library } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getDashboardSnapshot, listOfflineDecks, saveDashboardSnapshot } from "@/lib/offline-storage";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [
    { title: "Dashboard | Cogni" },
    { name: "description", content: "Continue studying, track progress, search shared decks, and see your Cogni ranking." },
    { property: "og:title", content: "Cogni Study Dashboard" },
    { property: "og:description", content: "Your personalized study dashboard for decks, quizzes, progress, and shared learning." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <RequireAuth><Dashboard /></RequireAuth>,
});

type Deck = { id: string; title: string; subject: string | null; last_studied_at: string | null; created_at: string; card_count: number };
type LeaderRow = { user_id: string; display_name: string; university: string | null; mastered_count: number; avg_score: number };
type SharedDeck = { id: string; title: string; subject: string | null; course_name: string | null; created_at: string; user_id: string; sharer_name: string; card_count: number };

function Dashboard() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [stats, setStats] = useState({ mastered: 0, avgScore: 0, streak: 0, totalCards: 0 });
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [sharedDecks, setSharedDecks] = useState<SharedDeck[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<(SharedDeck & { program: string | null })[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      if (!navigator.onLine) {
        const snapshot = await getDashboardSnapshot(user.id);
        const savedDecks = await listOfflineDecks();
        if (snapshot) {
          setDecks(snapshot.decks as Deck[]);
          setStats(snapshot.stats);
        } else {
          setDecks(savedDecks.map((item) => ({
            id: item.id,
            title: String(item.deck.title ?? "Saved deck"),
            subject: typeof item.deck.subject === "string" ? item.deck.subject : null,
            last_studied_at: typeof item.deck.last_studied_at === "string" ? item.deck.last_studied_at : null,
            created_at: typeof item.deck.created_at === "string" ? item.deck.created_at : item.savedAt,
            card_count: item.cards.length,
          })));
        }
        setOffline(true);
        setLoading(false);
        return;
      }
      const { data: deckRows } = await supabase
        .from("decks").select("id, title, subject, last_studied_at, created_at, flashcards(count)")
        .eq("user_id", user.id).is("archived_at", null).order("created_at", { ascending: false });
      const mapped: Deck[] = (deckRows ?? []).map((d: any) => ({
        id: d.id, title: d.title, subject: d.subject, last_studied_at: d.last_studied_at,
        created_at: d.created_at, card_count: d.flashcards?.[0]?.count ?? 0,
      }));
      setDecks(mapped);

      const { count: masteredCount } = await supabase.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "got_it");
      const { count: totalCount } = await supabase.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", user.id);
      const { data: sessions } = await supabase.from("study_sessions").select("score, total, completed_at").eq("user_id", user.id).order("completed_at", { ascending: false }).limit(50);
      let avg = 0; if (sessions && sessions.length) {
        const ratios = sessions.map(s => s.total > 0 ? s.score / s.total : 0);
        avg = Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
      }
      const days = new Set((sessions ?? []).map(s => new Date(s.completed_at).toDateString()));
      let streak = 0; const cur = new Date();
      while (days.has(cur.toDateString())) { streak++; cur.setDate(cur.getDate() - 1); }
      setStats({ mastered: masteredCount ?? 0, avgScore: avg, streak, totalCards: totalCount ?? 0 });
      await saveDashboardSnapshot({ userId: user.id, decks: mapped, stats: { mastered: masteredCount ?? 0, avgScore: avg, streak, totalCards: totalCount ?? 0 }, savedAt: new Date().toISOString() });

      const { data: lb } = await supabase.rpc("get_leaderboard" as any);
      setLeaderboard(((lb ?? []) as any[]).map(r => ({
        user_id: r.user_id, display_name: r.display_name, university: r.university,
        mastered_count: Number(r.mastered_count ?? 0), avg_score: Number(r.avg_score ?? 0),
      })));

      const { data: shared } = await supabase.rpc("get_program_shared_decks" as any);
      setSharedDecks(((shared ?? []) as any[]).map(r => ({
        id: r.id, title: r.title, subject: r.subject, course_name: r.course_name,
        created_at: r.created_at, user_id: r.user_id, sharer_name: r.sharer_name,
        card_count: Number(r.card_count ?? 0),
      })));
      setLoading(false);
    })();
  }, [user]);

  // Next milestone for the progress bar
  const milestones = [10, 25, 50, 100, 250, 500, 1000];
  const nextMilestone = milestones.find(m => m > stats.mastered) ?? stats.mastered + 100;
  const prevMilestone = [...milestones].reverse().find(m => m <= stats.mastered) ?? 0;
  const progressPct = nextMilestone === prevMilestone ? 100 : Math.min(100, Math.round(((stats.mastered - prevMilestone) / (nextMilestone - prevMilestone)) * 100));
  const myRankIndex = leaderboard.findIndex(r => r.user_id === user?.id);
  const myRank = myRankIndex >= 0 ? myRankIndex + 1 : null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 sm:flex sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase text-primary">Your study command centre</p>
          <h1 className="truncate font-display text-2xl font-bold sm:text-3xl">Good evening{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(" ")[0]}` : ""}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keep going — every answer moves you forward.</p>
        </div>
        <Button asChild className="shrink-0 shadow-brand"><Link to="/create"><Sparkles /> <span className="hidden sm:inline">Create a deck</span><span className="sm:hidden">Create</span></Link></Button>
      </div>

      {offline && <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">You're offline. Showing decks saved on this device; community and ranking updates will return when connected.</div>}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { icon: Target, label: "Cards mastered", value: stats.mastered, sub: `of ${stats.totalCards} total` },
          { icon: TrendingUp, label: "Quiz average", value: `${stats.avgScore}%`, sub: "last 50 sessions" },
          { icon: Flame, label: "Study streak", value: `${stats.streak}d`, sub: "keep it alive" },
          { icon: BookOpen, label: "Decks", value: decks.length, sub: "in your library" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border/70 bg-card/70 p-4 backdrop-blur-sm transition hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.label}</span>
              <s.icon className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-2 font-display text-2xl font-bold sm:text-3xl">{s.value}</div>
            <div className="mt-1 text-xs text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Progress to next milestone */}
      <div className="rounded-lg border border-primary/25 bg-card/75 p-5 glow-soft">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
              <Trophy className="h-3.5 w-3.5" /> Next milestone
            </div>
            <h3 className="mt-1 font-display text-2xl font-bold">{nextMilestone} cards mastered</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {nextMilestone - stats.mastered} cards to go — keep the momentum.
            </p>
          </div>
          <div className="text-right">
            <div className="font-display text-3xl font-bold text-primary">{progressPct}%</div>
            <div className="text-xs text-muted-foreground">{stats.mastered} / {nextMilestone}</div>
          </div>
        </div>
        <Progress value={progressPct} className="mt-4 h-3" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border/70 bg-card/65 p-5">
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-display text-lg font-semibold">Continue studying</h2><p className="mt-1 text-sm text-muted-foreground">Resume a recent deck or start a fresh session.</p></div>
              <Library className="h-5 w-5 text-primary" />
            </div>
            <div className="mt-4 space-y-2">
              {decks.slice(0, 3).map((deck, index) => (
                <Link key={deck.id} to="/decks/$deckId" params={{ deckId: deck.id }} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 bg-background/35 p-3 transition hover:border-primary/35 hover:bg-muted/60">
                  <div className="min-w-0"><div className="truncate font-medium">{deck.title}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{deck.subject ?? "General study"} · {deck.card_count} cards</div></div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{index === 0 ? "Continue" : "Study"}<ArrowRight className="h-3.5 w-3.5" /></span>
                </Link>
              ))}
              {!loading && decks.length === 0 && <Link to="/create" className="block rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground hover:border-primary/40">Create your first deck</Link>}
            </div>
          </section>

          {/* Browse decks from other programs */}
          {!offline && <div className="rounded-lg border border-primary/20 bg-card/65 p-5">
            <h2 className="font-display text-lg font-semibold flex items-center gap-2"><Search className="h-5 w-5 text-primary" /> Find shared decks</h2>
            <p className="mt-1 text-sm text-muted-foreground">Search by program, course, subject, or deck title.</p>
            <form className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={async (e) => {
              e.preventDefault(); setSearching(true);
              const { data, error } = await supabase.rpc("search_decks_by_program" as any, { p_query: searchQuery });
              setSearching(false); if (error) return;
              setSearchResults(((data ?? []) as any[]).map(r => ({ id: r.id, title: r.title, subject: r.subject, course_name: r.course_name, created_at: r.created_at, user_id: r.user_id, sharer_name: r.sharer_name, program: r.program, card_count: Number(r.card_count ?? 0) })));
            }}>
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search all shared study material…" className="min-w-0" />
              <Button type="submit" size="icon" disabled={searching} title="Search decks">{searching ? <Loader2 className="animate-spin" /> : <Search />}</Button>
            </form>
            {searchResults !== null && <div className="mt-4 grid gap-2 sm:grid-cols-2">{searchResults.length === 0 ? <p className="text-sm text-muted-foreground">No matching decks found.</p> : searchResults.map((d) => <Link key={d.id} to="/decks/$deckId" params={{ deckId: d.id }} className="rounded-lg border border-border/60 bg-background/35 p-3 hover:border-primary/35"><div className="truncate font-medium">{d.title}</div><div className="mt-1 text-xs text-muted-foreground">{d.card_count} cards · by {d.sharer_name}</div></Link>)}</div>}
          </div>}
        </div>

      {/* Leaderboard */}
      {!offline && <div className="rounded-lg border border-border/70 bg-card/65 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold flex items-center gap-2">
              <Crown className="h-5 w-5 text-primary" /> Global leaderboard
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">Top 10 by correct answers.</p>
          </div>
          {myRank ? (
            <div className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary">
              You're #{myRank}
            </div>
          ) : (
            <div className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground">
              Master more cards to enter the ranking
            </div>
          )}
        </div>
        <ol className="mt-5 space-y-2">
          {leaderboard.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rankings yet — be the first.</p>
          ) : leaderboard.slice(0, 10).map((row, i) => {
            const isMe = row.user_id === user?.id;
            const rankIcon = i === 0 ? <Crown className="h-4 w-4 text-yellow-400" /> : i === 1 ? <Medal className="h-4 w-4 text-slate-300" /> : i === 2 ? <Medal className="h-4 w-4 text-amber-600" /> : <span className="text-xs text-muted-foreground">#{i + 1}</span>;
            return (
              <li key={row.user_id} className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${isMe ? "border-primary/50 bg-primary/10" : "border-border/60 bg-background/35"}`}>
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-card border border-border">{rankIcon}</span>
                  <div>
                    <div className="font-medium">{row.display_name}{isMe && <span className="ml-2 text-xs text-primary">(you)</span>}</div>
                    {row.university && <div className="text-xs text-muted-foreground">{row.university}</div>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-bold text-primary">{row.mastered_count}</div>
                  <div className="text-xs text-muted-foreground">correct · {row.avg_score}% avg</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>}
      </div>

      {/* Shared in your program */}

      {!offline && <div className="rounded-lg border border-border/70 bg-card/45 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" /> Shared in your program
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Papers and quizzes contributed by classmates in your degree.</p>
          </div>
          <Link to="/chat" className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20">
            <MessageCircle className="h-4 w-4" /> Open program chat
          </Link>
        </div>
        {sharedDecks.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No shared decks yet. Set your program in your <Link to="/profile" className="text-primary underline">profile</Link>, then upload a paper to share it with classmates.
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sharedDecks.map((d) => (
              <Link key={d.id} to="/decks/$deckId" params={{ deckId: d.id }} className="group rounded-lg border border-border/70 bg-background/35 p-4 transition hover:border-primary/50">
                <div className="flex items-start justify-between">
                  <h3 className="font-display text-lg font-semibold leading-snug group-hover:text-primary">{d.title}</h3>
                  <Share2 className="h-4 w-4 text-primary" />
                </div>
                {d.course_name && <div className="mt-2 font-mono text-xs text-primary">{d.course_name}</div>}
                {d.subject && <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{d.subject}</span>}
                <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{d.card_count} cards</span>
                  <span>Shared by <span className="text-foreground">{d.sharer_name}</span></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>}

      <div>

        <h2 className="font-display text-xl font-semibold">Your library</h2>
        {loading ? (
          <p className="mt-4 text-muted-foreground">Loading…</p>
        ) : decks.length === 0 ? (
          <Link to="/create" className="mt-4 grid place-items-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center hover:border-primary/50">
            <Plus className="h-8 w-8 text-primary" />
            <p className="mt-3 font-medium">Create your first deck</p>
            <p className="mt-1 text-sm text-muted-foreground">Upload a PDF, paste notes, or snap a photo of your handwritten study guide.</p>
          </Link>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {decks.map((d) => (
              <div key={d.id} className="group relative rounded-lg border border-border/70 bg-card/65 p-4 transition hover:border-primary/50">
                <Link to="/decks/$deckId" params={{ deckId: d.id }} className="block">
                  <div className="flex items-start justify-between">
                    <h3 className="font-display text-lg font-semibold leading-snug group-hover:text-primary pr-8">{d.title}</h3>
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  {d.subject && <span className="mt-2 inline-flex rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">{d.subject}</span>}
                  <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{d.card_count} cards</span>
                    <span>{d.last_studied_at ? `Studied ${formatDistanceToNow(new Date(d.last_studied_at), { addSuffix: true })}` : "Not studied yet"}</span>
                  </div>
                </Link>
                <button
                  aria-label="Remove deck from your dashboard"
                  onClick={async (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (!confirm("Remove this deck from your dashboard? Classmates with the link can still access it.")) return;
                    const { error } = await supabase.from("decks").update({ archived_at: new Date().toISOString() } as any).eq("id", d.id);
                    if (error) { toast.error(error.message); return; }
                    setDecks((ds) => ds.filter(x => x.id !== d.id));
                    toast.success("Deck removed");
                  }}
                  className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-lg border border-border bg-background/80 text-destructive transition hover:bg-destructive/10 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
