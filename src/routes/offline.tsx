import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/math-text";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";
import { BookOpen, FileText, FolderOpen, PlayCircle, RefreshCw, Trash2, CheckCircle2, XCircle } from "lucide-react";
import {
  getProgress, listMaterials, listOfflineDecks, listQuizAttempts, listSubjects, makeOfflineId,
  queueStudyEvent, recordLocalAnswer, removeMaterial, saveQuizAttempt,
  type OfflineMaterial, type OfflineProgress, type OfflineQuizAttempt, type OfflineSubject,
} from "@/lib/offline-storage";
import { syncOfflineResults } from "@/components/connectivity-manager";

export const Route = createFileRoute("/offline")({
  head: () => ({ meta: [
    { title: "Offline Study | Cogni" },
    { name: "description", content: "Continue studying your saved Cogni decks, subjects and materials without internet." },
    { property: "og:title", content: "Offline Study | Cogni" },
    { property: "og:description", content: "Study saved decks and practice quizzes offline on Cogni." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <RequireAuth><OfflinePage /></RequireAuth>,
});

type Deck = Awaited<ReturnType<typeof listOfflineDecks>>[number];
type QCard = { id: string; deckId: string; question: string; answer: string; explanation: string | null; topic: string | null; choices: string[] | null };

function shuffle<T>(a: T[]) { return [...a].sort(() => Math.random() - 0.5); }

function toChoices(c: Record<string, unknown>): string[] | null {
  const answer = String(c.answer ?? "");
  const opts = Array.isArray(c.options) ? (c.options as unknown[]).map(String) : null;
  if (opts && opts.length >= 2) return opts;
  const d = Array.isArray(c.distractors) ? (c.distractors as unknown[]).map(String) : null;
  if (d && d.length >= 2) return shuffle([answer, ...d.slice(0, 3)]);
  return null;
}

function OfflinePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [subjects, setSubjects] = useState<OfflineSubject[]>([]);
  const [materials, setMaterials] = useState<OfflineMaterial[]>([]);
  const [attempts, setAttempts] = useState<OfflineQuizAttempt[]>([]);
  const [progress, setProgress] = useState<OfflineProgress | null>(null);
  const [quiz, setQuiz] = useState<QCard[] | null>(null);

  async function refresh() {
    const [d, s, m, a, p] = await Promise.all([
      listOfflineDecks(), listSubjects(), listMaterials(), listQuizAttempts(), user ? getProgress(user.id) : null,
    ]);
    setDecks(d); setSubjects(s); setMaterials(m.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)));
    setAttempts(a.sort((x, y) => y.date.localeCompare(x.date))); setProgress(p);
  }
  useEffect(() => { void refresh(); }, [user?.id]);

  // Subjects: stored subjects merged with subjects derived from downloaded decks.
  const subjectList = useMemo(() => {
    const map = new Map<string, { name: string; decks: number; cards: number }>();
    for (const s of subjects) map.set(s.name, { name: s.name, decks: 0, cards: 0 });
    for (const d of decks) {
      const name = String(d.deck.subject ?? d.deck.course_name ?? "General");
      const e = map.get(name) ?? { name, decks: 0, cards: 0 };
      e.decks++; e.cards += d.cards.length; map.set(name, e);
    }
    return [...map.values()];
  }, [subjects, decks]);

  function startQuiz(deckFilter?: string) {
    const pool: QCard[] = decks.filter(d => !deckFilter || d.id === deckFilter).flatMap(d => d.cards.map(c => ({
      id: String(c.id), deckId: d.id, question: String(c.question ?? ""), answer: String(c.answer ?? ""),
      explanation: (c.explanation as string) ?? null, topic: (c.topic as string) ?? null, choices: toChoices(c),
    })));
    if (!pool.length) { toast.error("Download a deck while online to practice offline."); return; }
    setQuiz(shuffle(pool).slice(0, 10));
  }

  const unsynced = attempts.filter(a => !a.synced).length;
  const lastDeck = progress?.lastDeckId ? decks.find(d => d.id === progress.lastDeckId) : decks[0];

  if (quiz && user) return <PracticeQuiz cards={quiz} userId={user.id} onDone={() => { setQuiz(null); void refresh(); }} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Offline study</h1>
          <p className="text-sm text-muted-foreground">Everything here is saved on this device and works without internet.</p>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { const n = await syncOfflineResults(); toast.success(navigator.onLine ? `Synced ${n} answer${n === 1 ? "" : "s"}.` : "You're offline — results will sync later."); void refresh(); }}>
          <RefreshCw className="h-4 w-4" /> Sync now {unsynced > 0 && `(${unsynced})`}
        </Button>
      </div>

      {/* Continue studying */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><PlayCircle className="h-5 w-5 text-primary" /> Continue studying</h2>
        {lastDeck ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{String(lastDeck.deck.title ?? progress?.lastDeckTitle ?? "Saved deck")}</p>
              <p className="text-xs text-muted-foreground">
                {progress ? `${progress.attempted} answered · ${progress.accuracy}% accuracy · ${progress.streak}-day streak` : `${lastDeck.cards.length} cards saved`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => startQuiz(lastDeck.id)}>Quick practice</Button>
              <Button size="sm" asChild><Link to="/decks/$deckId" params={{ deckId: lastDeck.id }}>Open deck</Link></Button>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">No downloaded decks yet. Open a deck online and tap “Available offline”.</p>}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        {/* My subjects */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><FolderOpen className="h-5 w-5 text-primary" /> My subjects</h2>
          {subjectList.length ? (
            <ul className="space-y-2">
              {subjectList.map(s => {
                const mastery = progress?.topicMastery[s.name];
                return (
                  <li key={s.name} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{s.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.decks} deck{s.decks === 1 ? "" : "s"} · {s.cards} cards{mastery !== undefined && ` · ${mastery}%`}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Subjects appear once you download or study a deck.</p>}
        </section>

        {/* Practice quiz */}
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen className="h-5 w-5 text-primary" /> Practice quiz</h2>
          <p className="mb-3 text-sm text-muted-foreground">10 random questions from your downloaded decks.</p>
          <Button onClick={() => startQuiz()} disabled={!decks.length}>Start practice quiz</Button>
          {attempts.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-xs">
              {attempts.slice(0, 5).map(a => (
                <li key={a.id} className="flex justify-between text-muted-foreground">
                  <span>{new Date(a.date).toLocaleString()}</span>
                  <span>{a.score}/{a.total} ({a.percentage}%) {a.synced ? "· synced" : "· waiting to sync"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Saved materials */}
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary" /> Saved materials</h2>
        {materials.length ? (
          <ul className="space-y-2">
            {materials.map(m => (
              <li key={m.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{m.fileName}{m.subject && <span className="text-muted-foreground"> · {m.subject}</span>}</span>
                    <button className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove material"
                      onClick={async (e) => { e.preventDefault(); await removeMaterial(m.id); void refresh(); }}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </summary>
                  <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">{m.text.slice(0, 5000)}</p>
                </details>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Documents you upload on the Create page are kept here for offline reading.</p>}
      </section>
    </div>
  );
}

function PracticeQuiz({ cards, userId, onDone }: { cards: QCard[]; userId: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [start] = useState(Date.now());
  const card = cards[i];

  async function grade(correct: boolean, answer: string) {
    setRevealed(true);
    if (correct) setScore(s => s + 1);
    setAnswers(a => [...a, answer]);
    await recordLocalAnswer(userId, { correct, topic: card.topic, deckId: card.deckId, scorePct: correct ? 100 : 0 });
    await queueStudyEvent({ id: makeOfflineId(), userId, deckId: card.deckId, mode: "offline_practice", score: correct ? 1 : 0, total: 1, completedAt: new Date().toISOString() });
    if (navigator.onLine) void syncOfflineResults();
  }

  async function next() {
    if (i + 1 < cards.length) { setI(i + 1); setPicked(null); setRevealed(false); return; }
    const total = cards.length;
    await saveQuizAttempt({
      id: makeOfflineId(), deckId: card.deckId, questionIds: cards.map(c => c.id), answers, score, total,
      percentage: Math.round((score / total) * 100), date: new Date().toISOString(), timeTakenMs: Date.now() - start, synced: false,
    });
    if (navigator.onLine) await syncOfflineResults();
    toast.success(`Practice done: ${score}/${total}`);
    onDone();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Question {i + 1} of {cards.length}</span>
        <button onClick={onDone} className="hover:text-foreground">Exit</button>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-lg font-medium"><MathText>{card.question}</MathText></div>
        {card.choices ? (
          <div className="mt-4 grid gap-2">
            {card.choices.map(c => {
              const isAnswer = c.trim().toLowerCase() === card.answer.trim().toLowerCase();
              const state = revealed ? (isAnswer ? "border-primary bg-primary/10" : picked === c ? "border-destructive bg-destructive/10" : "border-border") : "border-border hover:border-primary";
              return (
                <button key={c} disabled={revealed} onClick={() => { setPicked(c); void grade(isAnswer, c); }}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${state}`}><MathText>{c}</MathText></button>
              );
            })}
          </div>
        ) : !revealed && (
          <Button className="mt-4" variant="outline" onClick={() => setRevealed(true)}>Show answer</Button>
        )}
        {revealed && (
          <div className="mt-4 space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
            <p><span className="font-medium">Answer: </span><MathText>{card.answer}</MathText></p>
            {card.explanation && <p className="text-muted-foreground"><MathText>{card.explanation}</MathText></p>}
          </div>
        )}
        {revealed && !card.choices && answers.length === i && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => grade(true, "self:correct")}><CheckCircle2 className="h-4 w-4" /> I got it</Button>
            <Button size="sm" variant="outline" onClick={() => grade(false, "self:missed")}><XCircle className="h-4 w-4" /> I missed it</Button>
          </div>
        )}
        {revealed && answers.length > i && <Button className="mt-4 w-full" onClick={next}>{i + 1 < cards.length ? "Next" : "Finish"}</Button>}
      </div>
    </div>
  );
}
