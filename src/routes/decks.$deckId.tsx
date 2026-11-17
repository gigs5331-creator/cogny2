import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { AppHeader } from "@/components/app-header";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { StudyMode } from "@/components/study-mode";
import { QuizMode } from "@/components/quiz-mode";
import { MultipleChoiceMode } from "@/components/multiple-choice-mode";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, BookOpen, Brain, ListChecks, Loader2, Trash2, Share2, MessageCircle, Download, Check } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { getOfflineDeck, makeOfflineId, queueStudyEvent, recordLocalAnswer, removeOfflineDeck, saveDeckOffline, saveQuizAttempt, saveSubject } from "@/lib/offline-storage";

type Card = Database["public"]["Tables"]["flashcards"]["Row"];
type Deck = Database["public"]["Tables"]["decks"]["Row"];

const QUIZ_SIZE = 20;
const GUEST_LIMIT = 2;

function chunkCards<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export const Route = createFileRoute("/decks/$deckId")({
  head: () => ({ meta: [
    { title: "Study Deck | Cogni" },
    { name: "description", content: "Practice flashcards and quizzes in a Cogni study deck." },
    { property: "og:title", content: "Study Deck | Cogni" },
    { property: "og:description", content: "Practice this flashcard and quiz deck on Cogni." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { property: "og:image", content: "https://cogny-ai.lovable.app/cogni-logo.jpeg" },
    { name: "twitter:image", content: "https://cogny-ai.lovable.app/cogni-logo.jpeg" },
  ] }),
  component: DeckRoute,
});

function DeckRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (user) {
    return <RequireAuth><DeckPage isGuest={false} /></RequireAuth>;
  }
  return (
    <div className="min-h-screen bg-grid">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6"><DeckPage isGuest={true} /></main>
    </div>
  );
}


function DeckPage({ isGuest }: { isGuest: boolean }) {
  const { deckId } = Route.useParams();
  const { user } = useAuth();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"mc" | "quiz" | "study">("mc");
  const [filter, setFilter] = useState<"all" | "review" | "Easy" | "Medium" | "Hard">("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [quizPart, setQuizPart] = useState(0);
  const [availableOffline, setAvailableOffline] = useState(false);

  const topics = useMemo(() => {
    const set = new Set<string>();
    cards.forEach(c => { if (c.topic) set.add(c.topic); });
    return Array.from(set);
  }, [cards]);

  const topicCards = useMemo(
    () => topicFilter === "all" ? cards : cards.filter(c => c.topic === topicFilter),
    [cards, topicFilter]
  );
  const quizParts = useMemo(() => chunkCards(topicCards, QUIZ_SIZE), [topicCards]);
  const totalQuizParts = quizParts.length;

  useEffect(() => { setQuizPart(0); }, [mode, topicFilter]);

  async function load() {
    try {
      const cached = await getOfflineDeck(deckId);
      setAvailableOffline(Boolean(cached));
      if (!navigator.onLine && cached) {
        setDeck(cached.deck as Deck);
        setCards(cached.cards as Card[]);
        return;
      }
      const { data: d, error: deckError } = await supabase.from("decks").select("*").eq("id", deckId).single();
      if (deckError) throw deckError;
      const { data: c, error: cardsError } = await supabase.from("flashcards").select("*").eq("deck_id", deckId).order("position");
      if (cardsError) throw cardsError;
      setDeck(d);
      setCards(c ?? []);
      if (cached && d) await saveDeckOffline(deckId, { deck: d, cards: c ?? [], savedAt: new Date().toISOString() });
    } catch {
      const cached = await getOfflineDeck(deckId);
      if (cached) {
        setDeck(cached.deck as Deck);
        setCards(cached.cards as Card[]);
        setAvailableOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [deckId]);

  async function markCard(id: string, status: Card["status"]) {
    let updatedCards: Card[] = [];
    setCards((cs) => {
      updatedCards = cs.map(c => c.id === id ? { ...c, status } : c);
      return updatedCards;
    });
    if (navigator.onLine) {
      await supabase.from("flashcards").update({ status }).eq("id", id);
      await supabase.from("decks").update({ last_studied_at: new Date().toISOString() }).eq("id", deckId);
    }
    if (availableOffline && deck) {
      await saveDeckOffline(deckId, { deck, cards: updatedCards, savedAt: new Date().toISOString() });
    }
  }

  // Record every single answer as it happens, so a student's score counts
  // even if they never finish the quiz.
  async function onAnswered(score: number, total: number) {
    if (!user) return;
    const sessionMode = mode === "mc" ? "mcq" : "quiz";
    const event = { id: makeOfflineId(), userId: user.id, deckId, mode: sessionMode, score, total, completedAt: new Date().toISOString() };
    const topic = topicFilter !== "all" ? topicFilter : (cards[0]?.topic ?? deck?.subject ?? null);
    void recordLocalAnswer(user.id, {
      correct: score > 0, topic, deckId, deckTitle: deck?.title ?? null,
      scorePct: total > 0 ? Math.round((score / total) * 100) : null,
    }).catch(() => {});
    if (deck?.subject) void saveSubject({ id: deck.subject, name: deck.subject, topics, updatedAt: new Date().toISOString() }).catch(() => {});
    if (!navigator.onLine) {
      await queueStudyEvent(event);
      return;
    }
    const { error } = await supabase.from("study_sessions").insert({ id: event.id, user_id: user.id, deck_id: deckId, mode: sessionMode, score, total, completed_at: event.completedAt });
    if (error) {
      await queueStudyEvent(event);
      toast.info("Answer saved on this device and will sync when you're online.");
      return;
    }
    supabase.from("decks").update({ last_studied_at: new Date().toISOString() }).eq("id", deckId).then(() => {});
  }

  async function onQuizComplete(score: number, total: number) {
    if (!user) return;
    void saveQuizAttempt({
      id: makeOfflineId(), deckId, questionIds: [], answers: [], score, total,
      percentage: total > 0 ? Math.round((score / total) * 100) : 0,
      date: new Date().toISOString(), timeTakenMs: 0, synced: navigator.onLine,
    }).catch(() => {});
    if (score > 0) toast.success(navigator.onLine ? `Nice! +${score} added to the leaderboard 🏆` : `Nice! +${score} saved — it will reach the leaderboard when you're online.`);
  }


  async function deleteDeck() {
    if (!deck) return;
    const isShared = deck.is_public || (deck as any).shared_with_program;
    const msg = isShared
      ? "Remove this deck from your dashboard? It will stay available to classmates who already have the link."
      : "Delete this deck? It will be removed from your dashboard.";
    if (!confirm(msg)) return;
    const { error } = await supabase.from("decks").update({ archived_at: new Date().toISOString() }).eq("id", deckId);
    if (error) return toast.error(error.message);
    toast.success("Deck removed from your dashboard");
    window.location.href = "/dashboard";
  }

  async function shareOnWhatsApp() {
    if (!deck) return;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://cogny-ai.lovable.app";
    const deckUrl = `${baseUrl}/decks/${deckId}`;
    const sample = cards[0];
    const lines = [
      `🧠 *${deck.title}* — flashcard quiz on Cogny AI`,
      deck.subject ? `📚 ${deck.subject}` : null,
      `${cards.length} questions`,
      "",
      sample ? `Sample question:` : null,
      sample ? `❓ ${sample.question}` : null,
      "",
      `Think you know the answer? Tap the link to take the full quiz:`,
      deckUrl,
    ].filter(Boolean).join("\n");
    const text = encodeURIComponent(lines);
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  async function togglePublic() {
    if (!deck) return;
    const { error } = await supabase.from("decks").update({ is_public: !deck.is_public }).eq("id", deckId);
    if (error) return toast.error(error.message);
    setDeck({ ...deck, is_public: !deck.is_public });
    toast.success(deck.is_public ? "Deck is now private" : "Deck is now public");
  }

  async function toggleOffline() {
    if (!deck) return;
    if (availableOffline) {
      await removeOfflineDeck(deckId);
      setAvailableOffline(false);
      toast.success("Offline copy removed");
    } else {
      await saveDeckOffline(deckId, { deck, cards, savedAt: new Date().toISOString() });
      setAvailableOffline(true);
      toast.success("Deck is ready offline");
    }
  }

  const filtered = cards.filter(c => {
    if (filter === "all") return true;
    if (filter === "review") return c.status === "missed" || c.status === "review_later";
    return c.difficulty === filter;
  });

  if (loading) return <div className="grid place-items-center py-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!deck) return <p>Deck not found.</p>;
  // Guests can only view decks that are shared/public. Anything else -> login.
  if (isGuest && !(deck.is_public || (deck as any).shared_with_program)) return <Navigate to="/login" />;

  const isOwner = user?.id === deck.user_id;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
          <h1 className="mt-2 font-display text-3xl font-bold">{deck.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {deck.subject && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-primary text-xs">{deck.subject}</span>}
            <span>{cards.length} cards</span>
            {deck.is_public && <span className="text-primary">· Public</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!isGuest && <Button variant="outline" size="sm" onClick={toggleOffline}>
            {availableOffline ? <Check className="h-4 w-4 mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            {availableOffline ? "Available offline" : "Download"}
          </Button>}
          <Button variant="outline" size="sm" onClick={shareOnWhatsApp} className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700">
            <MessageCircle className="h-4 w-4 mr-1" /> Share on WhatsApp
          </Button>
          {isOwner && (
            <>
              <Button variant="outline" size="sm" onClick={togglePublic}><Share2 className="h-4 w-4 mr-1" /> {deck.is_public ? "Make private" : "Make public"}</Button>
              <Button variant="outline" size="sm" onClick={deleteDeck} className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="inline-flex w-full sm:w-auto overflow-x-auto rounded-xl border border-border bg-card p-1">
          <button onClick={() => setMode("mc")} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm sm:px-4 ${mode === "mc" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <ListChecks className="h-4 w-4" /> <span className="whitespace-nowrap">Multiple choice</span>
          </button>
          {!isGuest && <button onClick={() => setMode("quiz")} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm sm:px-4 ${mode === "quiz" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <Brain className="h-4 w-4" /> <span className="whitespace-nowrap">Open quiz</span>
          </button>}
          {!isGuest && <button onClick={() => setMode("study")} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm sm:px-4 ${mode === "study" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <BookOpen className="h-4 w-4" /> Study
          </button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {topics.length > 1 && (
            <Select value={topicFilter} onValueChange={(v) => setTopicFilter(v)}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Topic" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All topics ({cards.length})</SelectItem>
                {topics.map(t => (
                  <SelectItem key={t} value={t}>
                    {t} ({cards.filter(c => c.topic === t).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {mode === "study" && (
            <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cards</SelectItem>
                <SelectItem value="review">Needs review</SelectItem>
                <SelectItem value="Easy">Easy</SelectItem>
                <SelectItem value="Medium">Medium</SelectItem>
                <SelectItem value="Hard">Hard</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {mode !== "study" && totalQuizParts > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Quiz part:</span>
          {quizParts.map((_, i) => (
            <button
              key={i}
              onClick={() => setQuizPart(i)}
              className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm border transition-colors ${
                quizPart === i
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/50"
              }`}
            >
              Part {i + 1}
            </button>
          ))}
        </div>
      )}

      {mode === "study" && <StudyMode cards={topicFilter === "all" ? filtered : topicCards.filter(c => filter === "all" ? true : filter === "review" ? (c.status === "missed" || c.status === "review_later") : c.difficulty === filter)} onMark={markCard} />}
      {mode === "quiz" && (
        <QuizMode
          cards={(quizParts[quizPart] ?? []).map(c => ({ id: c.id, question: c.question, answer: c.answer, explanation: c.explanation, diagram: (c as any).diagram ?? null, questionType: (c as any).question_type ?? null, options: ((c as any).options as string[] | null) ?? null, distractors: (c as any).distractors ?? null }))}
          onAnswered={onAnswered}
          onComplete={onQuizComplete}

        />
      )}
      {mode === "mc" && (
        <MultipleChoiceMode
          deckId={`${deckId}:${topicFilter}${isGuest ? ":guest" : ""}`}
          part={quizPart}
          cards={(quizParts[quizPart] ?? []).map(c => ({ id: c.id, question: c.question, answer: c.answer, explanation: c.explanation, topic: c.topic, distractors: (c as any).distractors ?? null, diagram: (c as any).diagram ?? null, questionType: (c as any).question_type ?? null, options: ((c as any).options as string[] | null) ?? null }))}
          onAnswered={onAnswered}
          onComplete={onQuizComplete}

          guestLimit={isGuest ? GUEST_LIMIT : undefined}
        />
      )}

    </div>
  );
}
