import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/components/require-auth";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [
    { title: "Your Profile | Cogni" },
    { name: "description", content: "Manage your Cogni student profile and study details." },
    { property: "og:title", content: "Your Profile | Cogni" },
    { property: "og:description", content: "Manage your Cogni student profile." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <RequireAuth><Profile /></RequireAuth>,
});

function Profile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ display_name: "", university: "", program: "", year_part: "", subjects: "" });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (data) setForm({
        display_name: data.display_name ?? "",
        university: data.university ?? "",
        program: (data as any).program ?? "",
        year_part: data.year_part ?? "",
        subjects: (data.subjects ?? []).join(", "),
      });
      setLoading(false);
    })();
  }, [user]);

  async function save() {
    if (!user) return;
    setBusy(true);
    const subjects = form.subjects.split(",").map(s => s.trim()).filter(Boolean);
    const { error } = await supabase.from("profiles").update({
      display_name: form.display_name, university: form.university, program: form.program, year_part: form.year_part, subjects,
    } as any).eq("id", user.id);
    setBusy(false);
    if (error) toast.error(error.message); else toast.success("Profile saved");
  }

  if (loading) return <div className="grid place-items-center py-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Your profile</h1>
        <p className="mt-1 text-muted-foreground">Tell Cogni about your studies so decks stay organised.</p>
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <div><Label>Display name</Label><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
        <div><Label>University</Label><Input value={form.university} onChange={(e) => setForm({ ...form, university: e.target.value })} placeholder="e.g. University of Cape Town" /></div>
        <div><Label>Program / Degree</Label><Input value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} placeholder="e.g. BSc Computer Science, MBChB" /><p className="mt-1 text-xs text-muted-foreground">Used to share quizzes with classmates in the same program.</p></div>
        <div><Label>Year / Part</Label><Input value={form.year_part} onChange={(e) => setForm({ ...form, year_part: e.target.value })} placeholder="e.g. 2nd year / MBChB IV" /></div>
        <div><Label>Subjects (comma-separated)</Label><Textarea value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} rows={3} placeholder="Anatomy, Biochemistry, Pharmacology" /></div>
        <div className="text-xs text-muted-foreground">Email: {user?.email}</div>
        <Button onClick={save} disabled={busy} className="w-full"><Save className="h-4 w-4 mr-2" /> Save profile</Button>
      </div>
    </div>
  );
}
