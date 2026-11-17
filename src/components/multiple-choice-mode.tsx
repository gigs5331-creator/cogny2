import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Check, X, Trophy, PartyPopper, MessageCircle, RotateCcw, ChevronRight, Sparkles, Lock } from "lucide-react";
import { MathText } from "@/components/math-text";
import { Diagram } from "@/components/diagram";
import { resolveQuestion, TYPE_INSTRUCTIONS, TYPE_LABELS } from "@/lib/question-types";

type Card = { id: string; question: string; answer: string; explanation: string | null; topic?: string | null; distractors?: string[] | null; diagram?: string | null; questionType?: string | null; options?: string[] | null };

type Option = { text: string; correct: boolean };

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normaliseLen(s: string, target: number): string {
  // Trim very long distractors so options look uniform; don't expand short ones.
  const max = Math.max(target + 30, Math.round(target * 1.4));
  if (s.length > max) return s.slice(0, max - 1).trimEnd() + "…";
  return s;
}

function buildOptions(card: Card, all: Card[]): Option[] {
  const resolved = resolveQuestion(card);

  // Authored options (multiple choice / true-false) always win — never rebuild them.
  if (resolved.options.length >= 2) {
    const answer = card.answer.trim().toLowerCase();
    const opts = resolved.options.map((text) => ({ text, correct: text.trim().toLowerCase() === answer }));
    if (!opts.some((o) => o.correct)) opts[0] = { text: card.answer, correct: true };
    return resolved.type === "true_false" ? opts : shuffle(opts);
  }

  let distractors: string[] = [];
  if (card.distractors && card.distractors.length >= 3) {
    distractors = card.distractors.slice(0, 3);
  } else {
    // Fallback: pick distractors from same-topic cards first, then anywhere.
    const sameTopic = all.filter((c) => c.id !== card.id && c.topic && card.topic && c.topic === card.topic).map((c) => c.answer);
    const others = all.filter((c) => c.id !== card.id).map((c) => c.answer);
    const pool = sameTopic.length >= 3 ? sameTopic : [...sameTopic, ...others.filter((a) => !sameTopic.includes(a))];
    distractors = shuffle(pool).slice(0, 3);
    while (distractors.length < 3) distractors.push("—");
  }
  const target = card.answer.length;
  const opts: Option[] = [
    { text: card.answer, correct: true },
    ...distractors.map((t) => ({ text: normaliseLen(t, target), correct: false })),
  ];
  return shuffle(opts);
}

export function MultipleChoiceMode({ deckId, cards, onComplete, onAnswered, part = 0, guestLimit }: { deckId: string; cards: Card[]; onComplete: (score: number, total: number) => void; onAnswered?: (score: number, total: number) => void; part?: number; guestLimit?: number }) {
  const quiz = useMemo(() => cards, [cards]);
  const storageKey = `mc:${deckId}:p${part}`;

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [resumed, setResumed] = useState(false);
  const optionsRef = useRef<Option[][]>([]);
  const completedRef = useRef(false);

  // Build options once per quiz
  if (optionsRef.current.length === 0 && quiz.length > 0) {
    optionsRef.current = quiz.map((c) => buildOptions(c, quiz));
  }

  // Restore saved progress
  useEffect(() => {
    if (resumed || quiz.length === 0) return;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s.idx === "number" && Array.isArray(s.answers) && s.total === quiz.length) {
          setIdx(s.idx);
          setAnswers(s.answers);
        }
      }
    } catch {}
    setResumed(true);
  }, [resumed, quiz.length, storageKey]);

  // Persist progress
  useEffect(() => {
    if (!resumed || finished) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ idx, answers, total: quiz.length, ts: Date.now() }));
    } catch {}
  }, [idx, answers, quiz.length, storageKey, resumed, finished]);

  function pick(optionIdx: number) {
    if (selected !== null) return;
    setSelected(optionIdx);
    setAnswers((a) => {
      const next = [...a];
      next[idx] = optionIdx;
      return next;
    });
    setRevealed(true);
    // Bank this answer immediately so it counts even if the quiz is abandoned.
    const isCorrect = Boolean(optionsRef.current[idx]?.[optionIdx]?.correct);
    onAnswered?.(isCorrect ? 1 : 0, 1);
  }


  function next() {
    setSelected(null);
    setRevealed(false);
    setIdx((i) => {
      const ni = i + 1;
      if (ni >= quiz.length) setFinished(true);
      return ni;
    });
  }

  function restart() {
    try { localStorage.removeItem(storageKey); } catch {}
    optionsRef.current = quiz.map((c) => buildOptions(c, quiz));
    completedRef.current = false;
    setAnswers([]);
    setSelected(null);
    setIdx(0);
    setFinished(false);
    setRevealed(false);
  }

  const score = useMemo(() => {
    let s = 0;
    answers.forEach((a, i) => {
      if (a !== null && a !== undefined && optionsRef.current[i]?.[a]?.correct) s++;
    });
    return s;
  }, [answers]);

  useEffect(() => {
    if (!finished || completedRef.current) return;
    completedRef.current = true;
    try { localStorage.removeItem(storageKey); } catch {}
    onComplete?.(score, quiz.length);
  }, [finished, score, quiz.length, onComplete, storageKey]);

  if (quiz.length === 0) return <p className="text-center text-muted-foreground py-12">No cards in this deck yet.</p>;

  if (finished) {
    const pct = Math.round((score / quiz.length) * 100);
    const tone = pct >= 80 ? "Outstanding!" : pct >= 60 ? "Nice work — keep going!" : pct >= 40 ? "Solid start — review and try again." : "Don't sweat it — practise makes perfect.";
    function shareWA() {
      const url = typeof window !== "undefined" ? window.location.href : "";
      const msg = encodeURIComponent(`I just scored ${score}/${quiz.length} (${pct}%) on a Cogny AI quiz! Try it: ${url}`);
      window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
    }
    return (
      <div className="space-y-6">
        <div className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center glow-soft">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
            {pct >= 60 ? <Trophy className="h-7 w-7 text-primary" /> : <PartyPopper className="h-7 w-7 text-primary" />}
          </div>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">{score} <span className="text-2xl text-muted-foreground">/ {quiz.length}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">{pct}% · {tone}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={restart} size="lg"><RotateCcw className="h-4 w-4 mr-2" /> Play again</Button>
            <Button onClick={shareWA} size="lg" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700">
              <MessageCircle className="h-4 w-4 mr-2" /> Share on WhatsApp
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          {quiz.map((q, i) => {
            const pickIdx = answers[i];
            const opts = optionsRef.current[i] ?? [];
            const correctIdx = opts.findIndex((o) => o.correct);
            const right = pickIdx !== null && pickIdx !== undefined && opts[pickIdx]?.correct;
            return (
              <div key={q.id} className={`rounded-2xl border p-5 ${right ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
                <div className="flex items-start gap-3">
                  {right ? <Check className="h-5 w-5 text-success mt-0.5" /> : <X className="h-5 w-5 text-destructive mt-0.5" />}
                  <div className="flex-1">
                    <p className="font-mono text-sm"><MathText>{q.question}</MathText></p>
                    <p className="mt-2 text-sm"><span className="text-muted-foreground">Your answer: </span>{pickIdx !== null && pickIdx !== undefined ? <MathText>{opts[pickIdx]?.text}</MathText> : <em className="text-muted-foreground">(skipped)</em>}</p>
                    {!right && <p className="mt-1 text-sm"><span className="text-muted-foreground">Correct: </span><span className="font-medium"><MathText>{opts[correctIdx]?.text}</MathText></span></p>}
                    {q.explanation && <p className="mt-2 text-xs text-muted-foreground"><MathText>{q.explanation}</MathText></p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const q = quiz[idx];
  const opts = optionsRef.current[idx] ?? [];
  const progress = ((idx + 1) / quiz.length) * 100;

  // Guest paywall: after answering `guestLimit` questions, prompt signup on the next card.
  if (guestLimit !== undefined && idx >= guestLimit) {
    const nextPath = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center glow-soft">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight">Nice work — keep going?</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            You've tried {guestLimit} questions on this deck. Create a free account to unlock the rest,
            save your score to the leaderboard, and build your own decks in seconds.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="lg">
              <Link to="/login" search={{ mode: "signup", ...(nextPath ? { next: nextPath } : {}) }}>
                <Sparkles className="h-4 w-4 mr-2" /> Sign up free to continue
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/login" search={{ mode: "signin", ...(nextPath ? { next: nextPath } : {}) }}>I already have an account</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Takes ~15 seconds · free forever for students</p>
        </div>
      </div>
    );
  }


  return (
    <div className="space-y-6 mx-auto max-w-2xl">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Question {idx + 1} / {quiz.length}</span>
      </div>
      <div className="h-2 sm:h-2.5 bg-muted rounded-full overflow-hidden ring-1 ring-border/50">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div className="perspective">
        <div className={`preserve-3d flip-transition relative w-full rounded-3xl grid ${revealed ? "rotate-y-180" : ""}`}>
          {/* FRONT */}
          <div className="backface-hidden [grid-area:1/1] rounded-3xl border border-border bg-card p-4 sm:p-8 flex flex-col glow-soft">

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{TYPE_LABELS[resolveQuestion(q).type === "true_false" ? "true_false" : "multiple_choice"]}</span>
              <span className="text-xs text-muted-foreground/80">· {resolveQuestion(q).type === "true_false" ? TYPE_INSTRUCTIONS.true_false : TYPE_INSTRUCTIONS.multiple_choice}</span>
            </div>
            <p className="font-mono text-base sm:text-lg leading-relaxed break-words"><MathText>{q.question}</MathText></p>
            <Diagram svg={q.diagram} />
            <div className="mt-5 flex-1 grid gap-2 sm:gap-3 auto-rows-fr">

              {opts.map((o, i) => {
                const isSel = selected === i;
                return (
                  <button
                    key={i}
                    disabled={selected !== null}
                    onClick={() => pick(i)}
                    className={`text-left rounded-xl sm:rounded-2xl border-2 px-3 py-2.5 sm:p-4 transition-all h-full ${isSel ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-accent"} disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="shrink-0 grid h-6 w-6 place-items-center rounded-md bg-muted text-xs font-semibold">{String.fromCharCode(65 + i)}</span>
                      <span className="text-sm min-w-0 flex-1 break-words [&_.katex]:whitespace-normal [&_.katex-display]:my-1 [&_.katex-display]:overflow-x-auto [&_.katex-display]:max-w-full"><MathText>{o.text}</MathText></span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* BACK */}
          <div className="backface-hidden rotate-y-180 [grid-area:1/1] rounded-3xl border p-5 sm:p-8 flex flex-col bg-card glow-soft">
            <div className="flex items-center gap-2">
              {selected !== null && opts[selected]?.correct ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/20 text-success px-3 py-1 text-xs font-medium">
                  <Check className="h-3.5 w-3.5" /> Correct
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 text-destructive px-3 py-1 text-xs font-medium">
                  <X className="h-3.5 w-3.5" /> Not quite
                </span>
              )}
            </div>

            <div className="mt-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Your answer</span>
              <p className="mt-1 text-sm text-foreground/80">{selected !== null ? <MathText>{opts[selected]?.text}</MathText> : "(none)"}</p>
            </div>

            <div className="mt-4">
              <span className="text-xs uppercase tracking-wider text-primary font-mono">Correct answer</span>
              <p className="mt-1 font-display text-lg font-semibold"><MathText>{q.answer}</MathText></p>
              <Diagram svg={q.diagram} />
            </div>


            {q.explanation && (
              <div className="mt-5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Explanation</span>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground"><MathText>{q.explanation}</MathText></p>
              </div>
            )}

            <Button onClick={next} className="mt-auto" size="lg">
              {idx === quiz.length - 1 ? "Finish quiz" : "Next question"} <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
