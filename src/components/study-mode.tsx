import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, X, ChevronRight, Shuffle, ListChecks, Keyboard, Sparkles, Loader2 } from "lucide-react";
import type { Database } from "@/integrations/supabase/types";
import { useServerFn } from "@tanstack/react-start";
import { judgeAnswer } from "@/lib/ai.functions";
import { toast } from "sonner";
import { MathText } from "@/components/math-text";
import { Diagram } from "@/components/diagram";


type Card = Database["public"]["Tables"]["flashcards"]["Row"];

function shuffleArr<T>(a: T[]): T[] { return [...a].sort(() => Math.random() - 0.5); }

function normalise(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function StudyMode({ cards, onMark }: { cards: Card[]; onMark: (id: string, status: Card["status"]) => void }) {
  const [order, setOrder] = useState<number[]>(() => cards.map((_, i) => i));
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<"type" | "mcq">("type");
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [wasRight, setWasRight] = useState(false);
  const [grading, setGrading] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const judge = useServerFn(judgeAnswer);

  useEffect(() => { setOrder(cards.map((_, i) => i)); setIdx(0); reset(); /* eslint-disable-next-line */ }, [cards.length]);

  const card = cards[order[idx] ?? 0];

  // Build MCQ options once per card: correct + 3 distractors from other cards' answers.
  const options = useMemo(() => {
    if (!card) return [] as string[];
    const others = cards.filter(c => c.id !== card.id).map(c => c.answer);
    const distractors = shuffleArr(others).filter(a => normalise(a) !== normalise(card.answer)).slice(0, 3);
    while (distractors.length < 3) distractors.push("(no other option)");
    return shuffleArr([card.answer, ...distractors]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, mode]);

  if (cards.length === 0) return <p className="text-center text-muted-foreground py-12">No cards in this filter.</p>;
  if (!card) return null;

  const progress = ((idx + 1) / order.length) * 100;

  function reset() { setTyped(""); setPicked(null); setRevealed(false); setWasRight(false); setFeedback(""); }

  async function submit() {
    if (revealed || grading) return;
    if (mode === "mcq") {
      const right = picked !== null && normalise(picked) === normalise(card.answer);
      setWasRight(right);
      setFeedback("");
      setRevealed(true);
      onMark(card.id, right ? "got_it" : "missed");
      return;
    }
    // mode === "type" — use semantic AI grading
    setGrading(true);
    try {
      const result = await judge({ data: {
        question: card.question,
        correctAnswer: card.answer,
        userAnswer: typed.trim(),
      }});
      setWasRight(result.correct);
      setFeedback(result.feedback || "");
      setRevealed(true);
      onMark(card.id, result.correct ? "got_it" : "missed");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't grade your answer — please try again.");
      setFeedback("Couldn't reach the grader. Check the model answer below and mark yourself honestly.");
      setWasRight(false);
      setRevealed(true);
      onMark(card.id, "missed");
    } finally {
      setGrading(false);
    }
  }

  function next() {
    reset();
    if (idx + 1 < order.length) setIdx(idx + 1);
    else { setOrder(shuffleArr(order)); setIdx(0); }
  }

  function shuffle() { setOrder(shuffleArr(order)); setIdx(0); reset(); }

  const canSubmit = (mode === "type" ? typed.trim().length > 0 : picked !== null) && !revealed && !grading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-border bg-card p-1">
          <button onClick={() => { setMode("type"); reset(); }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${mode === "type" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <Keyboard className="h-3.5 w-3.5" /> Type answer
          </button>
          <button onClick={() => { setMode("mcq"); reset(); }} className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${mode === "mcq" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
            <ListChecks className="h-3.5 w-3.5" /> Multiple choice
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={shuffle}><Shuffle className="h-4 w-4 mr-1" /> Shuffle</Button>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-2">
          <span>{idx + 1} / {order.length}</span>
          <span className="font-mono">{card.topic} · {card.difficulty}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="perspective">
        <div className={`preserve-3d flip-transition relative mx-auto min-h-[420px] w-full max-w-2xl rounded-3xl ${revealed ? "rotate-y-180" : ""}`}>
          {/* FRONT — question + input/MCQ */}
          <div className="backface-hidden absolute inset-0 rounded-3xl border border-border bg-card p-8 flex flex-col glow-soft">
            <span className="text-xs uppercase tracking-wider text-primary font-mono">Question</span>
            <p className="mt-4 font-mono text-lg leading-relaxed"><MathText>{card.question}</MathText></p>
            <Diagram svg={(card as any).diagram} />



            <div className="mt-6 flex-1">
              {mode === "type" ? (
                <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Your answer</label>
                  <Input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="Type your answer and press Enter…"
                    className="mt-2"
                  />
                </form>
              ) : (
                <div className="grid gap-2">
                  {options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setPicked(opt)}
                      className={`rounded-xl border p-3 text-left text-sm transition ${picked === opt ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"}`}
                    >
                      <MathText>{opt}</MathText>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button onClick={submit} disabled={!canSubmit} className="mt-6 w-full" size="lg">
              {grading
                ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Grading your answer…</>)
                : (<><Sparkles className="h-4 w-4 mr-2" /> Submit answer</>)}
            </Button>
          </div>

          {/* BACK — result + correct answer + explanation */}
          <div className={`backface-hidden rotate-y-180 absolute inset-0 rounded-3xl border p-8 flex flex-col overflow-y-auto ${wasRight ? "border-success/40 bg-success/5 glow-soft" : "border-destructive/40 bg-destructive/5"}`}>
            <div className="flex items-center gap-2">
              {wasRight
                ? <span className="inline-flex items-center gap-1 rounded-full bg-success/20 text-success px-3 py-1 text-xs font-medium"><Check className="h-3.5 w-3.5" /> Correct</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 text-destructive px-3 py-1 text-xs font-medium"><X className="h-3.5 w-3.5" /> Not quite</span>}
              <span className="text-xs text-muted-foreground font-mono">{card.topic}</span>
            </div>

            {!wasRight && (
              <div className="mt-4">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Your answer</span>
                <p className="mt-1 text-sm text-foreground/80">{mode === "type" ? (typed ? <MathText>{typed}</MathText> : "(blank)") : (picked ? <MathText>{picked}</MathText> : "(none)")}</p>
              </div>
            )}

            <div className="mt-4">
              <span className="text-xs uppercase tracking-wider text-primary font-mono">Correct answer</span>
              <p className="mt-1 font-display text-lg font-semibold"><MathText>{card.answer}</MathText></p>
              <Diagram svg={(card as any).diagram} />
            </div>


            {feedback && (
              <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
                <span className="text-xs uppercase tracking-wider text-primary font-mono">AI feedback</span>
                <p className="mt-1 text-sm leading-relaxed">{feedback}</p>
              </div>
            )}


            {card.explanation && (
              <div className="mt-5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Explanation</span>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground"><MathText>{card.explanation}</MathText></p>
              </div>
            )}

            <Button onClick={next} className="mt-auto" size="lg">
              Next card <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
