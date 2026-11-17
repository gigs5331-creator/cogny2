import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "@/components/app-header";
import { Brain, Sparkles, Zap, BookOpen, Upload, RefreshCw, GraduationCap, Star, ArrowRight, Trophy } from "lucide-react";
import studentsStudying from "@/assets/students-studying.jpg";
import studentFocus from "@/assets/student-focus.jpg";
import studyDesk from "@/assets/study-desk.jpg";
import graduation from "@/assets/graduation.jpg";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Cogni | Learn Smarter" },
    { name: "description", content: "Turn lecture notes, documents, and past papers into AI-powered flashcards and quizzes." },
    { property: "og:title", content: "Cogni | Learn Smarter" },
    { property: "og:description", content: "AI-powered flashcards and quizzes built for students." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { property: "og:image", content: "https://cogny-ai.lovable.app/cogni-logo.jpeg" },
    { name: "twitter:image", content: "https://cogny-ai.lovable.app/cogni-logo.jpeg" },
  ] }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" />;
  return (
    <div className="min-h-screen bg-grid">
      <AppHeader />

      {/* HERO */}
      <main className="mx-auto max-w-6xl px-4 pt-16 pb-24 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Built for university students
            </div>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] text-foreground sm:text-6xl">
              Study smarter. <br />
              <span className="text-primary text-glow">Graduate prouder.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Cogni turns your lecture notes, PDFs and past papers into beautiful AI flashcards and quizzes — so you actually remember what you learn.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Link to="/login" search={{ mode: "signup" }} className="group rounded-2xl border border-primary/40 bg-primary/10 p-4 hover:bg-primary/15 transition">
                <div className="flex items-center gap-2 text-primary text-sm font-medium"><GraduationCap className="h-4 w-4" /> I'm at university</div>
                <p className="mt-1 text-xs text-muted-foreground">Sign up with your email & student number.</p>
              </Link>
              <Link to="/high-school" search={{ mode: "signup" }} className="group rounded-2xl border border-border bg-card p-4 hover:border-primary/40 transition">
                <div className="flex items-center gap-2 text-foreground text-sm font-medium"><BookOpen className="h-4 w-4 text-primary" /> I'm in high school</div>
                <p className="mt-1 text-xs text-muted-foreground">Sign up with your email & a password.</p>
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link to="/login" search={{ mode: "signin" }} className="text-muted-foreground hover:text-foreground">University sign in →</Link>
              <Link to="/high-school" search={{ mode: "signin" }} className="text-muted-foreground hover:text-foreground">High school sign in →</Link>
            </div>
            <div className="mt-8 flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-1.5"><Star className="h-4 w-4 fill-primary text-primary" /> Loved by 10k+ students</div>
              <div className="hidden sm:flex items-center gap-1.5"><Trophy className="h-4 w-4 text-primary" /> Higher grades, less burnout</div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-primary/30 via-primary/10 to-transparent blur-2xl" />
            <img
              src={studentsStudying}
              alt="University students studying together with laptops"
              width={1536}
              height={1024}
              className="aspect-[3/2] w-full rounded-3xl border border-border object-cover glow-soft"
            />
            <div className="absolute -bottom-6 -left-6 hidden w-56 rotate-[-4deg] rounded-2xl border border-border bg-card p-4 shadow-2xl sm:block">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI explanation</div>
              <p className="mt-1 font-mono text-xs leading-relaxed text-foreground">"Mitochondria produce ATP via oxidative phosphorylation…"</p>
            </div>
          </div>
        </div>

        {/* SOCIAL STRIP */}
        <div className="mt-20 grid grid-cols-2 gap-6 rounded-3xl border border-border bg-card/60 p-8 sm:grid-cols-4">
          {[
            { k: "10k+", v: "Students" },
            { k: "1.2M", v: "Cards generated" },
            { k: "94%", v: "Pass rate boost" },
            { k: "4.9★", v: "Average rating" },
          ].map((s) => (
            <div key={s.v} className="text-center">
              <div className="font-display text-3xl font-bold text-primary">{s.k}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{s.v}</div>
            </div>
          ))}
        </div>

        {/* FEATURES */}
        <div className="mt-24 grid gap-6 sm:grid-cols-3">
          {[
            { icon: Upload, title: "Upload anything", body: "PDFs, Word docs, photos of notes, or pasted text. We handle the rest." },
            { icon: Brain, title: "AI extracts & explains", body: "Questions pulled out, answers generated, every card with a 3–5 sentence explanation." },
            { icon: Zap, title: "Study & quiz yourself", body: "3D flashcards, smart quizzes, progress tracking, and a daily streak." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6 glow-soft transition hover:-translate-y-1 hover:border-primary/40">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/15 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>

        {/* SPLIT — focus image + copy */}
        <div className="mt-24 grid items-center gap-10 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <img
              src={studentFocus}
              alt="Student smiling while studying with a book and coffee"
              loading="lazy"
              width={1024}
              height={1280}
              className="aspect-[4/5] w-full rounded-3xl border border-border object-cover glow-soft"
            />
          </div>
          <div className="lg:col-span-3">
            <h2 className="font-display text-4xl font-bold">Your private library. Always with you.</h2>
            <p className="mt-4 text-muted-foreground">
              Every deck is yours. Study from your phone between lectures, from your laptop the night before an exam, or share with classmates when you choose to. Streaks keep you consistent, quizzes keep you sharp.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "Auto-generated cards from PDFs, slides & notes",
                "Detailed AI explanations for every answer",
                "Smart quizzes with realistic distractors",
                "Daily streaks & subject-by-subject mastery",
              ].map((l) => (
                <li key={l} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 grid h-5 w-5 place-items-center rounded-full bg-primary/20 text-primary">✓</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* MOTIVATION GALLERY */}
        <div className="mt-24">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              <GraduationCap className="h-3.5 w-3.5" /> Your story starts here
            </div>
            <h2 className="mt-4 font-display text-4xl font-bold">Built for the late nights, made for the moments that matter.</h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <div className="group relative overflow-hidden rounded-3xl border border-border">
              <img src={studyDesk} alt="Open notebook with study notes, sticky notes and coffee" loading="lazy" width={1280} height={896} className="aspect-[16/11] w-full object-cover transition duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent" />
              <div className="absolute bottom-0 p-6">
                <h3 className="font-display text-xl font-semibold">Turn messy notes into mastery</h3>
                <p className="mt-1 text-sm text-muted-foreground">Drop in your handwritten notes — Cogni does the rest.</p>
              </div>
            </div>
            <div className="group relative overflow-hidden rounded-3xl border border-border">
              <img src={graduation} alt="Graduate throwing cap at sunset" loading="lazy" width={1280} height={896} className="aspect-[16/11] w-full object-cover transition duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/30 to-transparent" />
              <div className="absolute bottom-0 p-6">
                <h3 className="font-display text-xl font-semibold">Walk that stage with confidence</h3>
                <p className="mt-1 text-sm text-muted-foreground">Consistent study now. Proud moments later.</p>
              </div>
            </div>
          </div>
        </div>

        {/* TESTIMONIALS */}
        <div className="mt-24 grid gap-6 sm:grid-cols-3">
          {[
            { name: "Amina, Medicine Y3", quote: "I used Cogni for my anatomy practical and scored 88%. The explanations are clearer than my textbook." },
            { name: "Tariq, Law Y2", quote: "Past papers in, flashcards out. It's the only tool I open the week before exams." },
            { name: "Lerato, Eng Y1", quote: "The quizzes feel like a game. I actually look forward to studying now." },
          ].map((t) => (
            <div key={t.name} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex gap-0.5 text-primary">
                {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
              </div>
              <p className="mt-4 text-sm text-foreground">"{t.quote}"</p>
              <p className="mt-4 text-xs text-muted-foreground">{t.name}</p>
            </div>
          ))}
        </div>

        {/* FINAL CTA */}
        <div className="mt-24 overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/10 p-10 text-center glow-soft">
          <BookOpen className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 font-display text-4xl font-bold">Your next grade starts tonight.</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Free to start. No credit card. Just upload your first document and watch your study sessions transform.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" search={{ mode: "signup" }} className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground glow-primary">
              University sign up <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/high-school" search={{ mode: "signup" }} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-6 py-3 font-medium hover:bg-muted">
              High school sign up <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 py-8 text-center text-sm text-muted-foreground">
        <div className="inline-flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5" /> Cogni — study smarter, not longer.</div>
      </footer>
    </div>
  );
}
