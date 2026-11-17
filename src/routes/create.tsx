import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { ClaudeQuizImport } from "@/components/claude-quiz-import";
import { splitQuizParts } from "@/lib/quiz-import";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateFlashcards, classifyDocument } from "@/lib/ai.functions";
import { notifyNewDeck } from "@/lib/notify.functions";
import { extractFromFile } from "@/lib/extract-text";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageIcon, Sparkles, Upload, Trash2, Save, Users, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { listGenerations, makeOfflineId, queueGeneration, removeGeneration, saveMaterial, type PendingGeneration } from "@/lib/offline-storage";

export const Route = createFileRoute("/create")({
  component: () => <RequireAuth><Create /></RequireAuth>,
  head: () => ({
    meta: [
      { title: "Create Flashcards — Cogny AI" },
      { name: "description", content: "Upload any document and Cogny's multi-stage AI engine builds a complete quiz — no page limits, no question caps." },
      { property: "og:title", content: "Create and Import Quizzes — Cogny AI" },
      { property: "og:description", content: "Create study quizzes from your documents or import questions made in Claude." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type Card = { question: string; answer: string; explanation: string; topic: string; difficulty: "Easy" | "Medium" | "Hard"; questionType?: string; options?: string[] | null; distractors?: string[]; diagram?: string };

const CHUNK_SIZE = 10_000;      // chars per AI call — small enough that the AI never runs out of room
const CHUNK_OVERLAP = 1_500;    // preserve context across boundaries
const PARALLEL_LIMIT = 4;       // how many chunks to process at once
const MAX_RETRIES = 2;

type StageKey =
  | "ingest" | "ocr" | "index" | "chunk" | "process" | "dedupe" | "coverage" | "save";
type StageState = "pending" | "running" | "done" | "skipped" | "failed";

type ProgressState = {
  stages: Record<StageKey, StageState>;
  processed: number;
  total: number;
  failedChunks: number[];
  message: string;
};

const STAGE_LABELS: Record<StageKey, string> = {
  ingest: "Reading document",
  ocr: "OCR / image analysis",
  index: "Building knowledge map",
  chunk: "Smart chunking",
  process: "Generating questions in parallel",
  dedupe: "Removing duplicates",
  coverage: "Coverage report",
  save: "Saving deck",
};

function chunkCards<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function saveDeckParts(opts: {
  userId: string;
  baseTitle: string;
  subject: string | null;
  source: string;
  courseName: string;
  shareWithProgram: boolean;
  cards: Card[];
}): Promise<{ id: string; title: string }[]> {
  const groups = splitQuizParts(opts.cards);
  const created: { id: string; title: string }[] = [];
  for (let g = 0; g < groups.length; g++) {
    const title = groups.length > 1 ? `${opts.baseTitle} — Part ${g + 1}` : opts.baseTitle;
    const { data: deck, error } = await supabase.from("decks").insert({
      user_id: opts.userId,
      title,
      subject: opts.subject,
      source: opts.source,
      course_name: opts.courseName,
      shared_with_program: opts.shareWithProgram,
    } as any).select().single();
    if (error) throw error;
    const rows = groups[g].map((c, i) => ({
      deck_id: deck.id, user_id: opts.userId, question: c.question, answer: c.answer,
      explanation: c.explanation, topic: c.topic, difficulty: c.difficulty, position: i,
      question_type: c.questionType ?? "short_answer",
      options: c.options ?? null,
      distractors: c.distractors ?? null,
      diagram: c.diagram ?? null,
    }));

    const { error: e2 } = await supabase.from("flashcards").insert(rows as any);
    if (e2) throw e2;
    created.push({ id: deck.id, title });
  }
  return created;
}

// Split on paragraph / section boundaries with slight overlap so no concept is cut in half.
function smartSplit(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_SIZE, text.length);
    if (end < text.length) {
      // Prefer chapter/heading, then double newline, then single newline, then space
      const candidates = [
        text.lastIndexOf("\n\n\n", end),
        text.lastIndexOf("\n## ", end),
        text.lastIndexOf("\nChapter ", end),
        text.lastIndexOf("\nTopic ", end),
        text.lastIndexOf("\n\n", end),
        text.lastIndexOf(". ", end),
      ].filter((n) => n > i + CHUNK_SIZE * 0.5);
      if (candidates.length) end = Math.max(...candidates);
    }
    parts.push(text.slice(i, end));
    if (end >= text.length) break;
    i = Math.max(end - CHUNK_OVERLAP, i + 1);
  }
  return parts;
}

// Count numbered questions in a paper (e.g. "1.", "Q2)", "12 -") by finding the
// longest ascending run of question numbers, so headings/dates don't inflate the count.
function countNumberedQuestions(text: string): number {
  const nums: number[] = [];
  const re = /(^|\n)\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.):\-]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) nums.push(parseInt(m[2], 10));
  if (nums.length === 0) return 0;
  let best = 0, run = 0, expect = 1;
  for (const n of nums) {
    if (n === expect) { run++; expect++; }
    else if (n === 1) { run = 1; expect = 2; }
    else if (n === expect - 1) { /* sub-part repeat, ignore */ }
    else { best = Math.max(best, run); run = 0; expect = 1; }
    best = Math.max(best, run);
  }
  // Fall back to raw matches when numbering is unordered but clearly a question list.
  return Math.max(best, nums.length >= 5 && best < 5 ? 0 : best);
}

// Broader detector: numbered items, lettered items, or plain question sentences.
// Used so nothing in a document is missed, even when numbering is inconsistent.
function countQuestionCandidates(text: string): number {
  const numbered = countNumberedQuestions(text);
  const questionMarks = (text.match(/\?/g) || []).length;
  const lettered = (text.match(/(^|\n)\s*\(?[a-z]\)\s+\S/gi) || []).length;
  const bulleted = (text.match(/(^|\n)\s*[-•*]\s+.{15,}/g) || []).length;
  const stems = (text.match(/(^|\n)\s*(which|what|why|how|when|where|who|define|explain|describe|calculate|state|list|compare|discuss|outline|prove|derive|evaluate)\b/gi) || []).length;
  return Math.max(numbered, questionMarks, lettered, bulleted, stems);
}


// Pull chapter / topic / heading labels for the coverage report.

function buildKnowledgeMap(text: string): string[] {
  const lines = text.split(/\n+/);
  const found = new Set<string>();
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    const m = t.match(/^(chapter|topic|section|unit|part|module|lesson)\s+[\dIVX]+[:.\-]?\s*(.{0,80})/i);
    if (m) found.add(t.slice(0, 100));
    else if (/^#{1,3}\s+.{1,80}$/.test(t)) found.add(t.replace(/^#+\s+/, "").slice(0, 100));
  }
  return Array.from(found).slice(0, 40);
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

function Create() {
  const nav = useNavigate();
  const { user } = useAuth();
  const generate = useServerFn(generateFlashcards);
  const classify = useServerFn(classifyDocument);

  const notify = useServerFn(notifyNewDeck);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hint, setHint] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressState>({
    stages: { ingest: "pending", ocr: "pending", index: "pending", chunk: "pending", process: "pending", dedupe: "pending", coverage: "pending", save: "pending" },
    processed: 0,
    total: 0,
    failedChunks: [],
    message: "",
  });
  const [cards, setCards] = useState<Card[]>([]);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [courseName, setCourseName] = useState("");
  const [shareWithProgram, setShareWithProgram] = useState(true);
  const [coverage, setCoverage] = useState<{ topics: string[]; percent: number } | null>(null);
  const [pendingJobs, setPendingJobs] = useState<PendingGeneration[]>([]);
  const [queuedInput, setQueuedInput] = useState<PendingGeneration | null>(null);
  const [online, setOnline] = useState(true);
  const [imported, setImported] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const refresh = () => listGenerations().then((jobs) => setPendingJobs(jobs.filter((job) => job.userId === user.id)));
    const markOnline = () => { setOnline(true); void refresh(); };
    const markOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    void refresh();
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, [user]);

  function setStage(key: StageKey, state: StageState, msg?: string) {
    setProgress((p) => ({ ...p, stages: { ...p.stages, [key]: state }, message: msg ?? p.message }));
  }

  async function handleGenerate() {
    setProcessing(true);
    setProgress({
      stages: { ingest: "running", ocr: "pending", index: "pending", chunk: "pending", process: "pending", dedupe: "pending", coverage: "pending", save: "pending" },
      processed: 0, total: 0, failedChunks: [], message: "Reading your document…",
    });
    setCoverage(null);

    try {
      let derivedCourse = courseName.trim();
      let extractedText = "";
      let imagePages: { base64: string; mime: string }[] = [];
      let sourceName = file?.name ?? "pasted text";

      // STAGE 1 — Ingestion
      if (queuedInput) {
        extractedText = queuedInput.text;
        imagePages = queuedInput.imagePages;
        sourceName = queuedInput.source;
        if (!derivedCourse) derivedCourse = queuedInput.courseName;
        setStage("ingest", "done");
        setStage("ocr", imagePages.length ? "running" : "skipped", imagePages.length ? `Reading ${imagePages.length} saved page${imagePages.length > 1 ? "s" : ""} with OCR…` : undefined);
      } else if (file) {
        if (!derivedCourse) derivedCourse = file.name.replace(/\.[^.]+$/, "");
        const extracted = await extractFromFile(file);
        if (extracted.kind === "image") {
          imagePages = [{ base64: extracted.imageBase64, mime: extracted.imageMimeType }];
          if (text) extractedText = text;
          setStage("ingest", "done");
          setStage("ocr", "running", "Running vision analysis on image…");
        } else if (extracted.kind === "images") {
          imagePages = extracted.pages;
          if (text) extractedText = text;
          setStage("ingest", "done");
          setStage("ocr", "running", `Scanned document — reading ${imagePages.length} page${imagePages.length > 1 ? "s" : ""} with OCR…`);
        } else {
          extractedText = (text ? text + "\n\n" : "") + extracted.text;
          setStage("ingest", "done");
          setStage("ocr", "skipped");
        }
      } else if (text) {
        extractedText = text;
        setStage("ingest", "done");
        setStage("ocr", "skipped");
      } else {
        throw new Error("Paste some text or upload a file first.");
      }

      const usingImages = imagePages.length > 0;

      if (extractedText.trim()) {
        void saveMaterial({
          id: makeOfflineId(), subject: derivedCourse || null, topic: hint || null,
          fileName: file?.name ?? sourceName ?? "Pasted text", text: extractedText.slice(0, 200000),
          metadata: { chars: extractedText.length }, saved: true, updatedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      if (!navigator.onLine) {
        if (!user) throw new Error("Sign in online once before queuing a document.");
        const job: PendingGeneration = {
          id: makeOfflineId(), userId: user.id, source: file?.name ?? "pasted text",
          text: extractedText, imagePages, hint, courseName: derivedCourse, createdAt: new Date().toISOString(),
        };
        await queueGeneration(job);
        setPendingJobs((jobs) => [...jobs, job]);
        toast.success("Document saved. Connect to the internet to generate its flashcards.");
        return;
      }

      // STAGE 3 — Knowledge map
      setStage("index", "running", "Identifying chapters, topics, and concepts…");
      const knowledgeMap = buildKnowledgeMap(extractedText);
      setStage("index", "done");

      // STAGE 4 — Smart chunking
      setStage("chunk", "running", "Splitting on chapter / section boundaries…");
      let chunks = usingImages ? imagePages.map(() => extractedText) : smartSplit(extractedText);
      setStage("chunk", "done");
      if (usingImages) setStage("ocr", "done");

      // Detect question-paper style on the RAW text, before any classification can
      // strip questions away.
      const rawQuestionCount = usingImages ? 0 : countNumberedQuestions(extractedText);
      const rawChunks = chunks.slice();
      const looksLikeQuestionPaper = rawQuestionCount >= 3;

      // STAGE 4b — Separate administrative metadata from academic content.
      // Only the academic content is handed to the question generator.
      // Skipped for question papers: there the questions ARE the content, and we
      // must never risk the classifier discarding one of them.
      const classifiedTopics: string[] = [];
      if (!usingImages && !looksLikeQuestionPaper) {
        setStage("index", "running", "Separating exam instructions and metadata from academic content…");
        const structured = await runWithConcurrency(chunks, PARALLEL_LIMIT, async (chunk) => {
          try {
            const res = await classify({ data: { text: chunk } });
            classifiedTopics.push(...res.topics);
            const academic = (res.academicContent || "").trim();
            // Guard against over-aggressive stripping — keep the original when
            // the model returns far less than the source contained.
            return academic.length >= Math.min(200, chunk.length * 0.25) ? academic : chunk;
          } catch {
            return chunk;
          }
        });
        const kept = structured.filter((c) => c.trim().length > 40);
        if (kept.length) chunks = kept;
        extractedText = chunks.join("\n\n");
        setStage("index", "done", "Academic content isolated.");
      } else if (looksLikeQuestionPaper) {
        chunks = rawChunks;
        setStage("index", "done", "Question paper detected — every question kept.");
      }

      const detectedQuestions = Math.max(rawQuestionCount, countNumberedQuestions(extractedText));


      // Per-section detection so no section is under-generated when numbering is uneven.
      const chunkTargets = chunks.map((c) => {
        const detected = usingImages ? 0 : countQuestionCandidates(c);
        const words = c.split(/\s+/).filter(Boolean).length;
        const byLength = Math.max(8, Math.round(words / 120));
        return Math.max(detected, byLength);
      });

      // Scale target: ~1 card per 120 words, uncapped.
      const words = extractedText.split(/\s+/).filter(Boolean).length;
      const totalTarget = looksLikeQuestionPaper
        ? Math.max(detectedQuestions, chunkTargets.reduce((a, b) => a + b, 0))
        : Math.max(10, Math.round(words / 120), chunkTargets.reduce((a, b) => a + b, 0));


      if (looksLikeQuestionPaper) {
        toast.info(`Detected ${detectedQuestions} questions — generating one card for every single question.`);
      } else {
        toast.info(`${chunks.length} section${chunks.length > 1 ? "s" : ""} • aiming for ~${totalTarget} cards.`);
      }


      // STAGE 5 — Parallel processing with retries
      setStage("process", "running", `Processing ${chunks.length} section${chunks.length > 1 ? "s" : ""} in parallel…`);
      setProgress((p) => ({ ...p, total: chunks.length, processed: 0 }));

      let firstTitle = "";
      let firstSubject = "";
      const failed: number[] = [];

      const buildPayload = (chunk: string, idx: number, extraHint?: string) => {
        const target = Math.max(5, Math.min(looksLikeQuestionPaper ? 40 : 20, chunkTargets[idx] ?? 15));
        const payload: any = {
          hint: [hint, extraHint].filter(Boolean).join(" ") || undefined,
          targetCards: target,
          exactCount: looksLikeQuestionPaper,
        };
        if (usingImages && imagePages[idx]) {
          payload.imageBase64 = imagePages[idx].base64;
          payload.imageMimeType = imagePages[idx].mime;
          payload.hint = [hint, extraHint, imagePages.length > 1 ? `This is page ${idx + 1} of ${imagePages.length} of a scanned document. Extract EVERY question visible on this page.` : "Extract EVERY question visible in this image."]
            .filter(Boolean).join(" ") || undefined;
          if (chunk) payload.text = chunk;
        } else {
          payload.text = chunks.length > 1
            ? `[Section ${idx + 1} of ${chunks.length}]\n\n${chunk}`
            : chunk;
        }
        return payload;
      };

      // Rescue path: when a section keeps failing, split it into smaller pieces and
      // ask for fewer cards per piece so the AI reply always fits.
      const rescueSection = async (chunk: string, idx: number): Promise<any | null> => {
        if (usingImages || chunk.length < 1500) return null;
        const pieces: string[] = [];
        const size = Math.ceil(chunk.length / 3);
        for (let i = 0; i < chunk.length; i += size) pieces.push(chunk.slice(i, i + size + 300));
        const cards: Card[] = [];
        let title = "", subject = "";
        for (const piece of pieces) {
          const words = piece.split(/\s+/).filter(Boolean).length;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const r = await generate({ data: { text: piece, hint: hint || undefined, targetCards: Math.max(5, Math.min(12, Math.round(words / 120))) } });
              cards.push(...r.cards); title ||= r.suggested_title; subject ||= r.suggested_subject;
              break;
            } catch {
              await new Promise((res) => setTimeout(res, 2500 * (attempt + 1)));
            }
          }
        }
        return cards.length ? { suggested_title: title, suggested_subject: subject, cards } : null;
      };

      const chunkResults = await runWithConcurrency(chunks, PARALLEL_LIMIT, async (chunk, idx) => {
        const payload = buildPayload(chunk, idx);

        let lastErr: any = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            const result = await generate({ data: payload });
            setProgress((p) => ({ ...p, processed: p.processed + 1, message: `Processed section ${p.processed + 1}/${chunks.length}` }));
            return { ok: true as const, idx, result };
          } catch (e) {
            lastErr = e;
            // Back off longer on busy/rate-limit errors.
            const busy = /rate limit|429|busy/i.test(String((e as any)?.message ?? e));
            await new Promise((r) => setTimeout(r, (busy ? 6000 : 1500) * (attempt + 1)));
          }
        }
        console.error(`Chunk ${idx + 1} failed — trying smaller pieces`, lastErr);
        if (/credits exhausted/i.test(String(lastErr?.message ?? ""))) {
          failed.push(idx + 1);
          setProgress((p) => ({ ...p, processed: p.processed + 1, failedChunks: [...p.failedChunks, idx + 1] }));
          return { ok: false as const, idx, error: lastErr };
        }
        const rescued = await rescueSection(chunk, idx);
        if (rescued) {
          setProgress((p) => ({ ...p, processed: p.processed + 1, message: `Processed section ${p.processed + 1}/${chunks.length}` }));
          return { ok: true as const, idx, result: rescued };
        }
        failed.push(idx + 1);
        setProgress((p) => ({ ...p, processed: p.processed + 1, failedChunks: [...p.failedChunks, idx + 1] }));
        return { ok: false as const, idx, error: lastErr };
      });

      const allFailed = chunkResults.every((r) => !r.ok);
      if (allFailed) {
        const reason = String((chunkResults[0] as any)?.error?.message ?? "");
        throw new Error(reason && !/^AI generation failed$/.test(reason) ? reason : "The AI couldn't process this document right now — please try again in a minute.");
      }

      const successful = chunkResults.filter((r) => r.ok) as Array<{ ok: true; idx: number; result: any }>;
      if (successful.length === 0) throw new Error("All sections failed to process — please try again.");
      setStage("process", failed.length ? "done" : "done",
        failed.length ? `Completed with ${failed.length} skipped section${failed.length > 1 ? "s" : ""}.` : "All sections processed.");

      successful.sort((a, b) => a.idx - b.idx);
      firstTitle = successful[0].result.suggested_title;
      firstSubject = successful[0].result.suggested_subject;
      const allCards: Card[] = successful.flatMap((r) => r.result.cards);

      // STAGE 5b — Gap-fill sweeps: repeatedly re-scan any section that returned
      // fewer cards than the questions detected in it, asking only for what was
      // missed. For question papers we keep sweeping until nothing is left out.
      const sectionCards: Card[][] = chunks.map(() => []);
      for (const r of successful) sectionCards[r.idx] = (r.result.cards as Card[]).slice();

      const maxSweeps = looksLikeQuestionPaper ? 3 : 1;
      for (let sweep = 0; sweep < maxSweeps; sweep++) {
        const threshold = looksLikeQuestionPaper ? 1 : 0.85;
        const gapSections = successful
          .map((r) => ({ idx: r.idx, got: sectionCards[r.idx].length, want: chunkTargets[r.idx] ?? 0, cards: sectionCards[r.idx] }))
          .filter((s) => s.want > 0 && s.got < Math.ceil(s.want * threshold));
        if (gapSections.length === 0) break;

        setStage("process", "running", `Re-scanning ${gapSections.length} section${gapSections.length > 1 ? "s" : ""} for missed questions (pass ${sweep + 2})…`);
        const extra = await runWithConcurrency(gapSections, PARALLEL_LIMIT, async (s) => {
          const covered = s.cards.slice(0, 120).map((c) => `- ${c.question}`).join("\n");
          const missing = Math.max(3, s.want - s.got);
          const extraHint = `PASS ${sweep + 2}. The following questions were ALREADY captured from this section — do NOT repeat them:\n${covered}\n\nRe-read the section from the very beginning, line by line, including every sub-part (a), (b), (i), (ii), and extract the remaining ${missing} question(s) that were missed. Leave nothing out.`;
          try {
            const res = await generate({ data: { ...buildPayload(chunks[s.idx], s.idx, extraHint), targetCards: Math.max(5, Math.min(40, missing)) } });
            return { idx: s.idx, cards: res.cards as Card[] };
          } catch {
            return { idx: s.idx, cards: [] as Card[] };
          }
        });
        let recovered = 0;
        for (const e of extra) {
          if (!e.cards.length) continue;
          sectionCards[e.idx].push(...e.cards);
          allCards.push(...e.cards);
          recovered += e.cards.length;
        }
        if (recovered) {
          toast.success(`Recovered ${recovered} additional question${recovered > 1 ? "s" : ""}.`);
        } else {
          break;
        }
      }
      setStage("process", "done", "All sections processed.");

      // STAGE 5c — Whole-paper safety net: if a question paper still yields fewer
      // cards than questions counted in the document, sweep the full text once more.
      if (looksLikeQuestionPaper && !usingImages) {
        const uniqueSoFar = new Set(allCards.map((c) => c.question.trim().toLowerCase().slice(0, 120))).size;
        if (uniqueSoFar < detectedQuestions) {
          setStage("process", "running", `Only ${uniqueSoFar} of ${detectedQuestions} questions captured — doing a full-paper sweep…`);
          const covered = allCards.slice(0, 200).map((c) => `- ${c.question}`).join("\n");
          try {
            const res = await generate({
              data: {
                text: extractedText.slice(0, 60000),
                hint: `${hint ? hint + " " : ""}FINAL SWEEP of a question paper containing ${detectedQuestions} numbered questions. These are already captured — do NOT repeat them:\n${covered}\n\nGo through the paper from question 1 to the last question and return ONLY the questions that are missing above, including every sub-part.`,
                targetCards: Math.max(5, Math.min(40, detectedQuestions - uniqueSoFar)),
                exactCount: true,
              },
            });
            if (res.cards?.length) {
              allCards.push(...(res.cards as Card[]));
              toast.success(`Full-paper sweep recovered ${res.cards.length} more question${res.cards.length > 1 ? "s" : ""}.`);
            }
          } catch (e) {
            console.warn("Full-paper sweep failed", e);
          }
          setStage("process", "done", "All sections processed.");
        }
      }



      // STAGE 12 — Dedupe + concept tracking
      setStage("dedupe", "running", "Removing duplicates and near-identical questions…");
      const seen = new Set<string>();
      const conceptSeen = new Set<string>();
      const deduped = allCards.filter((c) => {
        const key = c.question.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
        if (seen.has(key)) return false;
        seen.add(key);
        conceptSeen.add((c.topic || "General").trim().toLowerCase());
        return true;
      });
      setStage("dedupe", "done");

      // STAGE 13 — Coverage report
      setStage("coverage", "running");
      const coveredTopics = Array.from(conceptSeen);
      const mapTopics = knowledgeMap.length > 0
        ? knowledgeMap
        : Array.from(new Set(classifiedTopics)).slice(0, 40);
      const expectedTopics = mapTopics.length > 0
        ? mapTopics.map((t) => t.toLowerCase())
        : coveredTopics;
      const hit = expectedTopics.filter((t) =>
        coveredTopics.some((c) => c.includes(t.slice(0, 20)) || t.includes(c.slice(0, 20))),
      ).length;
      const percent = expectedTopics.length ? Math.min(100, Math.round((hit / expectedTopics.length) * 100)) : 100;
      setCoverage({ topics: mapTopics.length ? mapTopics : Array.from(conceptSeen).slice(0, 20), percent });

      setStage("coverage", "done");

      const safeTitle = (firstTitle || derivedCourse || sourceName.replace(/\.[^.]+$/, "") || "Untitled deck").trim();
      const safeCourse = (derivedCourse || firstSubject || "General").trim();
      setCards(deduped);
      setTitle(safeTitle);
      setSubject(firstSubject);
      if (!derivedCourse) derivedCourse = firstSubject || safeTitle;
      setCourseName(safeCourse);

      if (failed.length) {
        toast.warning(`Generated ${deduped.length} cards. ${failed.length} section${failed.length > 1 ? "s" : ""} could not be processed and were skipped.`);
      } else {
        toast.success(
          looksLikeQuestionPaper
            ? `Generated ${deduped.length} cards from ${detectedQuestions} detected question${detectedQuestions > 1 ? "s" : ""}.`
            : `Generated ${deduped.length} cards covering ${conceptSeen.size} topic${conceptSeen.size > 1 ? "s" : ""}.`,
        );
      }

      // STAGE 8/15 — Auto-save (shared with program by default)
      if (user && deduped.length > 0) {
        setStage("save", "running", "Saving deck…");
        try {
          const created = await saveDeckParts({
            userId: user.id,
            baseTitle: safeTitle,
            subject: firstSubject?.trim() || null,
            source: sourceName,
            courseName: safeCourse,
            shareWithProgram: true,
            cards: deduped,
          });
          setStage("save", "done");
          if (created.length > 1) {
            toast.success(`Saved ${created.length} decks (split into parts) & shared with your program!`);
          } else {
            toast.success("Deck saved & shared with your program!");
          }
          for (const d of created) {
            notify({ data: { deckId: d.id, deckTitle: d.title } }).catch((err) => console.warn("Notify failed", err));
          }
          nav({ to: "/decks/$deckId", params: { deckId: created[0].id } });
          return;
        } catch (saveErr: any) {
          setStage("save", "failed");
          console.error("Auto-save failed", saveErr);
          toast.error("Auto-save failed — review and save manually below.");
        }
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Generation failed");
    } finally { setProcessing(false); }
  }

  async function handleSave() {
    if (!user || cards.length === 0 || saving) return;
    if (!title.trim()) { toast.error("Please give your deck a name so you don't mix up courses."); return; }
    if (!courseName.trim()) { toast.error("Please enter the course name for this paper."); return; }
    setSaving(true);
    try {
      const created = await saveDeckParts({
        userId: user.id,
        baseTitle: title.trim(),
        subject: subject?.trim() || null,
        source: imported ? "Manual Claude import" : queuedInput?.source ?? file?.name ?? "pasted text",
        courseName: courseName.trim(),
        shareWithProgram,
        cards,
      });
      if (created.length > 1) {
        toast.success(`Saved ${created.length} decks (split into parts). You can practise them any time.`);
      } else {
        toast.success("Deck saved! You can practise it any time.");
      }
      if (shareWithProgram) {
        for (const d of created) {
          notify({ data: { deckId: d.id, deckTitle: d.title } }).catch((err) => console.warn("Notify failed", err));
        }
      }
      nav({ to: "/decks/$deckId", params: { deckId: created[0].id } });
    } catch (e: any) {
      console.error("Save deck failed", e);
      toast.error(e?.message ?? "Save failed — please try again.");
    } finally { setSaving(false); }
  }

  if (processing) {
    const stageOrder: StageKey[] = ["ingest", "ocr", "index", "chunk", "process", "dedupe", "coverage", "save"];
    const pct = progress.total ? Math.round((progress.processed / progress.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-2xl py-10">
        <div className="text-center">
          <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full bg-primary/15">
            <Sparkles className="h-8 w-8 text-primary animate-pulse" />
            <span className="absolute inset-0 pulse-ring" />
          </div>
          <h2 className="mt-6 font-display text-2xl font-semibold">Building your study engine…</h2>
          <p className="mt-1 text-sm text-muted-foreground font-mono">{progress.message}</p>
        </div>

        {progress.total > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sections processed</span>
              <span className="font-mono">{progress.processed}/{progress.total} ({pct}%)</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <ul className="mt-6 space-y-2 rounded-xl border border-border bg-card p-4">
          {stageOrder.map((k) => {
            const state = progress.stages[k];
            return (
              <li key={k} className="flex items-center gap-3 text-sm">
                {state === "done" && <CheckCircle2 className="h-4 w-4 text-primary" />}
                {state === "running" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                {state === "pending" && <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />}
                {state === "skipped" && <span className="h-4 w-4 text-xs text-muted-foreground">—</span>}
                {state === "failed" && <AlertTriangle className="h-4 w-4 text-destructive" />}
                <span className={state === "pending" ? "text-muted-foreground" : ""}>{STAGE_LABELS[k]}</span>
              </li>
            );
          })}
        </ul>

        {progress.failedChunks.length > 0 && (
          <p className="mt-4 text-xs text-amber-500 text-center">
            Skipped section{progress.failedChunks.length > 1 ? "s" : ""} {progress.failedChunks.join(", ")} after retries — the rest of your quiz will still be built.
          </p>
        )}
      </div>
    );
  }

  if (cards.length > 0) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold">Review your deck</h1>
            <p className="text-sm text-muted-foreground">Edit anything before saving. {cards.length} cards {imported ? "imported" : "generated"}.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={() => { setCards([]); setCoverage(null); setImported(false); }}>Discard</Button>
            <Button onClick={handleSave} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? "Saving…" : "Save deck"}</Button>
          </div>
        </div>

        {coverage && (
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Document coverage</div>
                <p className="text-xs text-muted-foreground">Every major topic detected in your document is represented in the quiz.</p>
              </div>
              <div className="font-mono text-2xl font-bold text-primary">{coverage.percent}%</div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${coverage.percent}%` }} />
            </div>
            {coverage.topics.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {coverage.topics.slice(0, 24).map((t, i) => (
                  <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Deck name <span className="text-destructive">*</span></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Anatomy — Cardiovascular System" />
          </div>
          <div>
            <Label>Subject</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div>
            <Label>Course name <span className="text-destructive">*</span></Label>
            <Input value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. CSC2001F — Data Structures" />
            <p className="mt-1 text-xs text-muted-foreground">Helps classmates find this paper when browsing shared decks.</p>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-xl bg-background/40 border border-border p-4">
            <div className="flex gap-3">
              <Users className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <div className="font-medium">Share with my program</div>
                <p className="text-xs text-muted-foreground">Other students in your program will be able to study this deck. Your name will appear as the contributor.</p>
              </div>
            </div>
            <Switch checked={shareWithProgram} onCheckedChange={setShareWithProgram} />
          </div>
        </div>


        <div className="space-y-3">
          {cards.map((c, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{c.topic}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{c.difficulty}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCards(cards.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea className="mt-3 font-mono text-sm" value={c.question} onChange={(e) => { const v = [...cards]; v[i] = { ...c, question: e.target.value }; setCards(v); }} rows={2} />
              <Textarea className="mt-2" value={c.answer} onChange={(e) => { const v = [...cards]; v[i] = { ...c, answer: e.target.value }; setCards(v); }} rows={2} />
              <Textarea className="mt-2 text-sm text-muted-foreground" value={c.explanation} onChange={(e) => { const v = [...cards]; v[i] = { ...c, explanation: e.target.value }; setCards(v); }} rows={3} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Generate flashcards</h1>
        <p className="mt-1 text-muted-foreground">Upload anything — a 5-page assignment or a 500-page textbook. Offline documents are saved on this device and generated when you reconnect.</p>
      </div>

      {pendingJobs.length > 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-4">
          <div className="font-medium">{pendingJobs.length} document{pendingJobs.length > 1 ? "s" : ""} waiting for AI generation</div>
          <p className="mt-1 text-sm text-muted-foreground">Connect to continue. Text-based jobs can be restored below; scanned pages stay safely queued on this device.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {pendingJobs.map((job) => (
              <Button key={job.id} variant="outline" size="sm" disabled={!online} onClick={async () => {
                setText(job.text);
                setHint(job.hint);
                setCourseName(job.courseName);
                setQueuedInput(job);
                await removeGeneration(job.id);
                setPendingJobs((jobs) => jobs.filter((item) => item.id !== job.id));
                toast.info("Saved document restored. Tap Generate flashcards to continue.");
              }}>
                {job.source}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-dashed border-border bg-card p-6">
        <label className="flex cursor-pointer flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
            {file?.type.startsWith("image/") ? <ImageIcon className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
          </div>
          <div>
            <p className="font-medium">{file ? file.name : "Drop a file or click to upload"}</p>
            <p className="text-xs text-muted-foreground mt-1">PDF, Word, PowerPoint, Excel, CSV, text, images — any size, any document</p>
          </div>
          <input type="file" className="hidden" accept="*/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      <div>
        <Label htmlFor="paste">Or paste raw text / questions</Label>
        <Textarea id="paste" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste lecture notes, exam questions, a chapter summary…" className="mt-2 font-mono text-sm" />
      </div>

      <div>
        <Label htmlFor="hint">Optional hint (subject, level, focus)</Label>
        <Input id="hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. 2nd-year medical pharmacology, focus on mechanisms" className="mt-2" />
      </div>

      <Button onClick={handleGenerate} disabled={!file && !text && !queuedInput} className="w-full" size="lg">
        <Sparkles className="h-4 w-4 mr-2" /> Generate flashcards
      </Button>
      <ClaudeQuizImport onImport={quiz => {
        setCards(quiz.cards); setTitle(quiz.title); setSubject(quiz.subject);
        setCoverage(null); setImported(true);
        toast.success(`Imported all ${quiz.cards.length} questions. Review and save your quiz.`);
      }} />
    </div>
  );
}
