import { useEffect, useState } from "react";
import { Download, X, Upload, Brain, Zap, Trophy, WifiOff, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function InstallBanner() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (standalone || localStorage.getItem("cogni:install-dismissed")) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); setHidden(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setIos(true); setHidden(false); }
    const onInstalled = () => setHidden(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (hidden) return null;
  const dismiss = () => { localStorage.setItem("cogni:install-dismissed", "1"); setHidden(true); };
  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setEvt(null); setHidden(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border border-primary/40 bg-card p-4 shadow-2xl sm:bottom-5">
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold">Get the Cogni app</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ios ? "Tap the Share button in Safari, then “Add to Home Screen”." : "Install it on your phone or computer — opens fast and works offline."}
          </p>
          {!ios && (
            <Button size="sm" className="mt-3" onClick={install}><Download className="mr-1.5 h-4 w-4" /> Install app</Button>
          )}
        </div>
        <button onClick={dismiss} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

const steps = [
  { icon: Upload, title: "1. Upload your notes", body: "Tap “Create” and upload a PDF, Word doc, slides, a photo of notes or a past paper. Give it a course name." },
  { icon: Brain, title: "2. AI makes your cards", body: "Cogni finds every question and writes answers with clear explanations. Your deck saves itself." },
  { icon: Zap, title: "3. Practise", body: "Start with multiple choice, then flashcards and quizzes. Pause anytime and continue later." },
  { icon: Trophy, title: "4. Climb the scoreboard", body: "Every correct answer counts. Share decks with your program, chat with classmates, share on WhatsApp." },
  { icon: WifiOff, title: "5. Study offline", body: "Open a deck and tap “Available offline”. Use the Offline study page with no internet — results sync later." },
];

function WelcomeGuide() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const key = user ? `cogni:guide-seen:${user.id}` : "";

  useEffect(() => {
    if (!user) return;
    if (!localStorage.getItem(key)) setOpen(true);
    const reopen = () => { setStep(0); setOpen(true); };
    window.addEventListener("cogni:open-guide", reopen);
    return () => window.removeEventListener("cogni:open-guide", reopen);
  }, [user, key]);

  const close = () => { if (key) localStorage.setItem(key, "1"); setOpen(false); };
  const s = steps[step];
  const last = step === steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Welcome to Cogni</DialogTitle>
          <DialogDescription>Here's how it works — takes 30 seconds.</DialogDescription>
        </DialogHeader>
        <div className="rounded-2xl border border-border bg-muted/30 p-5">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 text-primary"><s.icon className="h-6 w-6" /></div>
          <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
        </div>
        <div className="flex justify-center gap-1.5">
          {steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/40"}`} />)}
        </div>
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={close}>Skip</Button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="outline" size="sm" onClick={() => setStep(step - 1)}>Back</Button>}
            <Button size="sm" onClick={() => (last ? close() : setStep(step + 1))}>
              {last ? "Start studying" : "Next"} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppOnboarding() {
  return (<><InstallBanner /><WelcomeGuide /></>);
}
