import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brain, Mail, Loader2, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "University Sign In | Cogni" },
    { name: "description", content: "Create or access your Cogni university study account." },
    { property: "og:title", content: "University Sign In | Cogni" },
    { property: "og:description", content: "Access your AI-powered university study space on Cogni." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: Login,
  validateSearch: (s: Record<string, unknown>): { mode?: "signin" | "signup"; next?: string } => ({
    mode: (s.mode === "signup" ? "signup" : "signin") as "signin" | "signup",
    ...(typeof s.next === "string" ? { next: s.next } : {}),
  }),

});

// Only allow same-origin relative paths as a post-login destination.
function safeNext(next?: string): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function Login() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { mode: initialMode, next } = Route.useSearch();
  const dest = safeNext(next);
  const [mode, setMode] = useState<"signin" | "signup">(initialMode ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [program, setProgram] = useState("");
  const [busy, setBusy] = useState(false);

  function go() {
    if (dest) { window.location.href = dest; return; }
    nav({ to: "/dashboard" });
  }

  if (user && !dest) return <Navigate to="/dashboard" />;
  if (user && dest) { window.location.href = dest; return null; }


  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const pwd = password;
      if (pwd.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }
      if (mode === "signup") {
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pwd,
          options: {
            emailRedirectTo: window.location.origin + (dest ?? "/dashboard"),
            data: { full_name: name, university, program, account_type: "university" },
          },
        });
        if (error && !/already|registered|exists/i.test(error.message)) throw error;
        let uid = signUpData?.session ? signUpData.user?.id : undefined;
        if (!uid) {
          const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
          if (signInErr) throw new Error("Account created. Please sign in with your password.");
          uid = signIn.user?.id ?? signUpData?.user?.id;
        }
        if (uid) {
          await supabase.from("profiles").update({
            display_name: name.trim() || null,
            university: university.trim() || null,
            program: program.trim() || null,
          } as any).eq("id", uid);
        }
        go();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pwd });
        if (error) throw error;
        go();
      }
    } catch (err: any) {
      toast.error(err.message ?? "Something went wrong");
    } finally { setBusy(false); }
  }

  async function handleGoogle() {
    if (!isSupabaseConfigured()) {
      toast.info("Google sign-in is unavailable without external OAuth configuration — please sign in or create an account with email & password below.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + (dest ?? "/dashboard") },
      });
      if (error) { toast.error(error.message ?? "Google sign-in failed"); setBusy(false); return; }
    } catch (e: any) {
      toast.error(e?.message ?? "Google sign-in failed"); setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-grid grid place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 glow-soft">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><Brain className="h-5 w-5" /></span>
          Cogni
        </Link>

        {/* Prominent Sign in / Sign up toggle */}
        <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl border border-border bg-background/50 p-1">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-lg py-2 text-sm font-medium transition ${mode === "signin" ? "bg-primary text-primary-foreground glow-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-lg py-2 text-sm font-medium transition ${mode === "signup" ? "bg-primary text-primary-foreground glow-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Sign up
          </button>
        </div>

        <h1 className="mt-6 font-display text-2xl font-bold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mode === "signin" ? "Sign in with your email and password." : "Join with your university email and a password."}</p>

        <Button onClick={handleGoogle} disabled={busy} variant="outline" className="mt-6 w-full">
          <svg className="h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.99.66-2.25 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.44.36-2.11V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"/></svg>
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or use email <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleEmail} className="space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="university">University</Label>
                <Input id="university" value={university} onChange={(e) => setUniversity(e.target.value)} required placeholder="e.g. University of Cape Town" />
              </div>
              <div>
                <Label htmlFor="program">Program / Degree</Label>
                <Input id="program" value={program} onChange={(e) => setProgram(e.target.value)} required placeholder="e.g. BSc Computer Science, MBChB" />
                <p className="mt-1 text-xs text-muted-foreground">Students in the same program can share quizzes and papers with you.</p>
              </div>
            </>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{mode === "signin" ? <><LogIn className="h-4 w-4 mr-2" /> Sign in</> : <><Mail className="h-4 w-4 mr-2" /> Create account</>}</>}
          </Button>
        </form>

        <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-3 text-center text-sm">
          {mode === "signin" ? (
            <>New to Cogni?{" "}
              <button onClick={() => setMode("signup")} className="font-semibold text-primary hover:underline">Create a free account</button>
            </>
          ) : (
            <>Already have an account?{" "}
              <button onClick={() => setMode("signin")} className="font-semibold text-primary hover:underline">Sign in</button>
            </>
          )}
        </div>
        <Link to="/high-school" search={{ mode }} className="mt-3 block text-center text-xs text-muted-foreground hover:text-primary">
          High school student? Use the high-school sign in →
        </Link>
      </div>
    </div>
  );
}
