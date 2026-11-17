import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { gradeOpenAnswers } from "@/lib/ai.functions";
import { Loader2, Sparkles, Check, X, ChevronRight, Trophy, PartyPopper, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { MathText } from "@/components/math-text";
import { Diagram } from "@/components/diagram";
import { resolveQuestion, numericallyEqual, parseNumeric, shuffle, TYPE_INSTRUCTIONS, TYPE_LABELS, type QuestionType } from "@/lib/question-types";

type Card = {
  id: string;
  question: string;
  answer: string;
  explanation: string | null;
  diagram?: string | null;
  questionType?: string | null;
  options?: string[] | null;
  distractors?: string[] | null;
};

type Grade = { score: number; max_marks: number; feedback: string };

export function QuizMode({ cards, onComplete, onAnswered }: { cards: Card[]; onComplete: (score: number, total: number) => void; onAnswered?: (score: number, total: number) => void }) {
  const grade = useServerFn(gradeOpenAnswers);
  const quiz = useMemo(() => cards, [cards]);
  // Resolve the type + options ONCE per card so options never change between renders.
  const resolved = useMemo(
    () =>
      quiz.map((c) => {
        const r = resolveQuestion(c);
        return {
          type: r.type as QuestionType,
          options: r.type === "true_false" ? ["True", "False"] : r.options.length ? shuffle(r.options) : [],
        };
      }),
    [quiz],
  );
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState(false);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [finished, setFinished] = useState(false);
  const hasCompletedRef = useRef(false);

  // Grade each answer as it's submitted so the score banks immediately —
  // even if the student never finishes the quiz.
  async function submitCurrent() {
    if (grading) return;
    const answer = current.trim();
    if (!answer) return;
    const type = resolved[idx]?.type ?? "short_answer";
    setAnswers((a) => [...a, answer]);

    // Objective types are graded locally — instant, deterministic, no AI needed.
    if (type === "multiple_choice" || type === "true_false") {
      const correct = answer.trim().toLowerCase() === quiz[idx].answer.trim().toLowerCase();
      const g: Grade = {
        score: correct ? 1 : 0,
        max_marks: 1,
        feedback: correct ? "Correct — well selected." : `Not quite — the correct answer is "${quiz[idx].answer}".`,
      };
      setGrades((gs) => [...gs, g]);
      onAnswered?.(g.score, g.max_marks);
      setRevealed(true);
      return;
    }

    if (type === "numerical") {
      const expected = parseNumeric(quiz[idx].answer);
      const got = parseNumeric(answer);
      if (expected !== null && got !== null) {
        const correct = numericallyEqual(expected, got);
        const g: Grade = {
          score: correct ? 1 : 0,
          max_marks: 1,
          feedback: correct ? "Correct — your value matches." : `Not quite — the expected value is ${quiz[idx].answer}.`,
        };
        setGrades((gs) => [...gs, g]);
        onAnswered?.(g.score, g.max_marks);
        setRevealed(true);
        return;
      }
    }

    setGrading(true);
    let g: Grade = { score: 0, max_marks: 1, feedback: "Couldn't grade — please try again." };
    try {
      const r = await grade({ data: { items: [{ question: quiz[idx].question, expected: quiz[idx].answer, userAnswer: answer }] } });
      if (r.grades?.[0]) g = r.grades[0];
    } catch (e: any) {
      toast.error(e?.message ?? "Grading failed");
    } finally {
      setGrading(false);
    }
    setGrades((gs) => [...gs, g]);
    onAnswered?.(g.score, g.max_marks);
    setRevealed(true);
  }

  function next() {
    setCurrent("");
    setRevealed(false);
    setIdx((i) => {
      const ni = i + 1;
      if (ni >= quiz.length) setFinished(true);
      return ni;
    });
  }

  const totals = useMemo(() => {
    const score = grades.reduce((s, g) => s + g.score, 0);
    const max = grades.reduce((s, g) => s + g.max_marks, 0);
    return { score, max, pct: max > 0 ? Math.round((score / max) * 100) : 0 };
  }, [grades]);

  useEffect(() => {
    if (!finished || hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    onComplete?.(totals.score, totals.max);
  }, [finished, totals, onComplete]);

  if (quiz.length === 0) {
    return <p className="text-center text-muted-foreground py-12">No cards to quiz on yet.</p>;
  }

  if (finished) {
    const { score, max, pct } = totals;
    const tone = pct >= 80 ? "Outstanding work!" : pct >= 60 ? "Solid effort — keep going!" : pct >= 40 ? "Decent start — review and try again." : "Don't sweat it — practise makes perfect.";

    function playAgain() {
      hasCompletedRef.current = false;
      setAnswers([]);
      setCurrent("");
      setIdx(0);
      setGrades([]);
      setFinished(false);
      setRevealed(false);
    }

    function shareOnWhatsApp() {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://cogny-ai.lovable.app";
      const deckUrl = typeof window !== "undefined" ? window.location.href : baseUrl;
      const msg = encodeURIComponent(`I just scored ${score}/${max} (${pct}%) on a Cogny AI quiz! Try it: ${deckUrl}`);
      window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
    }

    return (
      <div className="space-y-6">
        <div className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 text-center glow-soft">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
            {pct >= 60 ? <Trophy className="h-7 w-7 text-primary" /> : <PartyPopper className="h-7 w-7 text-primary" />}
          </div>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight">{score} <span className="text-2xl text-muted-foreground">/ {max}</span></h2>
          <p className="mt-1 text-sm text-muted-foreground">{pct}% · {tone}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button onClick={playAgain} size="lg">Practise again</Button>
            <Button onClick={shareOnWhatsApp} size="lg" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700">
              <MessageCircle className="h-4 w-4 mr-2" /> Share on WhatsApp
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          {quiz.map((q, i) => {
            const g = grades[i] ?? { score: 0, max_marks: 1, feedback: "Not answered." };
            const full = g.score >= g.max_marks;
            const partial = g.score > 0 && !full;
            const tone = full ? "border-success/30 bg-success/5" : partial ? "border-yellow-500/30 bg-yellow-500/5" : "border-destructive/30 bg-destructive/5";

            return (
              <div key={q.id} className={`rounded-2xl border p-5 ${tone}`}>
                <div className="flex items-start gap-3">
                  {full ? <Check className="h-5 w-5 text-success mt-0.5" /> : partial ? <Sparkles className="h-5 w-5 text-yellow-600 mt-0.5" /> : <X className="h-5 w-5 text-destructive mt-0.5" />}
                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-mono text-sm"><MathText>{q.question}</MathText></p>
                      <span className="shrink-0 rounded-full bg-background/60 border border-border px-2.5 py-0.5 text-xs font-semibold">{g.score}/{g.max_marks}</span>
                    </div>
                    <p className="mt-2 text-sm"><span className="text-muted-foreground">Your answer: </span>{answers[i] ? <MathText>{answers[i]}</MathText> : <em className="text-muted-foreground">(skipped)</em>}</p>
                    <p className="mt-1 text-sm"><span className="text-muted-foreground">Model answer: </span><span className="font-medium"><MathText>{q.answer}</MathText></span></p>
                    <p className="mt-2 text-xs text-muted-foreground italic">💬 {g.feedback}</p>
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
  const meta = resolved[idx] ?? { type: "short_answer" as QuestionType, options: [] as string[] };
  const isChoice = meta.type === "multiple_choice" || meta.type === "true_false";
  const progress = ((idx + 1) / quiz.length) * 100;

  return (
    <div className="space-y-6 mx-auto max-w-2xl">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Question {idx + 1} / {quiz.length}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      <div className="perspective">
        <div className={`preserve-3d flip-transition relative w-full rounded-3xl grid ${revealed ? "rotate-y-180" : ""}`}>
          {/* FRONT */}
          <div className="backface-hidden [grid-area:1/1] rounded-3xl border border-border bg-card p-4 sm:p-8 flex flex-col glow-soft">

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-primary">{TYPE_LABELS[meta.type]}</span>
              <span className="text-xs text-muted-foreground">{TYPE_INSTRUCTIONS[meta.type]}</span>
            </div>
            <p className="font-mono text-base sm:text-lg leading-relaxed break-words"><MathText>{q.question}</MathText></p>
            <Diagram svg={q.diagram} />
            <div className="mt-6 flex-1">
              {isChoice ? (
                <div className={`grid gap-2 sm:gap-3 ${meta.type === "true_false" ? "grid-cols-2" : ""}`}>
                  {meta.options.map((opt, i) => {
                    const isSel = current === opt;
                    return (
                      <button
                        key={`${opt}-${i}`}
                        type="button"
                        onClick={() => setCurrent(opt)}
                        className={`text-left rounded-xl sm:rounded-2xl border-2 px-3 py-2.5 sm:p-4 transition-all ${isSel ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-accent"}`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <span className={`shrink-0 grid h-6 w-6 place-items-center rounded-full border text-xs font-semibold ${isSel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted"}`}>
                            {meta.type === "true_false" ? "" : String.fromCharCode(65 + i)}
                          </span>
                          <span className="text-sm min-w-0 flex-1 break-words"><MathText>{opt}</MathText></span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : meta.type === "numerical" ? (
                <Input
                  autoFocus
                  inputMode="decimal"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitCurrent(); } }}
                  placeholder="e.g. 12.5"
                  className="text-base"
                />
              ) : (
                <Textarea
                  autoFocus
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submitCurrent(); }
                  }}
                  placeholder={meta.type === "essay" ? "Explain your answer using relevant concepts…" : "Answer briefly and clearly…"}
                  rows={meta.type === "essay" ? 8 : 4}
                  className="text-base"
                />
              )}
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {isChoice ? "Pick one option, then submit." : meta.type === "numerical" ? "Tip: Enter to submit" : "Tip: ⌘/Ctrl + Enter to submit"}
              </p>
              <Button onClick={submitCurrent} disabled={!current.trim() || grading} size="lg">
                {grading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Marking…</>) : "Submit answer"}
              </Button>
            </div>
          </div>

          {/* BACK */}
          <div className="backface-hidden rotate-y-180 [grid-area:1/1] rounded-3xl border p-5 sm:p-8 flex flex-col bg-card glow-soft">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 text-primary px-3 py-1 text-xs font-medium">
                <Check className="h-3.5 w-3.5" /> Answer revealed
              </span>
              {grades[idx] && (
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${grades[idx].score >= grades[idx].max_marks ? "bg-success/20 text-success" : grades[idx].score > 0 ? "bg-yellow-500/20 text-yellow-600" : "bg-destructive/20 text-destructive"}`}>
                  {grades[idx].score}/{grades[idx].max_marks} marks
                </span>
              )}
            </div>
            {grades[idx]?.feedback && <p className="mt-3 text-xs text-muted-foreground italic">💬 {grades[idx].feedback}</p>}


            <div className="mt-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Your answer</span>
              <p className="mt-1 text-sm text-foreground/80">{current ? <MathText>{current}</MathText> : "(blank)"}</p>
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
