import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth-context";
import { LayoutDashboard, Upload, LogOut, User, MessageCircle, Menu, ShieldCheck, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import logoAsset from "@/assets/cogni-logo.jpeg.asset.json";
import { getMyAdminStatus } from "@/lib/admin.functions";

const navigation = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Create deck", to: "/create", icon: Upload },
  { label: "Offline study", to: "/offline", icon: WifiOff },
  { label: "Program chat", to: "/chat", icon: MessageCircle },
  { label: "Profile", to: "/profile", icon: User },
] as const;

export function AppHeader() {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const checkAdmin = useServerFn(getMyAdminStatus);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) { setIsAdmin(false); return () => { active = false; }; }
    checkAdmin().then((result) => { if (active) setIsAdmin(result.isAdmin); }).catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, [checkAdmin, user]);

  const visibleNavigation = isAdmin
    ? [...navigation, { label: "Admin", to: "/admin", icon: ShieldCheck } as const]
    : navigation;

  if (user) return (
    <>
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar lg:sticky lg:top-0 lg:flex">
        <Link to="/dashboard" className="flex items-center gap-3 border-b border-border/60 px-5 py-5">
          <img src={logoAsset.url} alt="Cogni" className="h-10 w-10 rounded-lg object-cover shadow-brand" />
          <div className="min-w-0">
            <div className="font-display text-lg font-bold text-foreground">Cogni</div>
            <div className="text-[10px] uppercase text-muted-foreground">Learn smarter</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-1 p-3">
          {visibleNavigation.map((item) => {
            const active = pathname === item.to;
            return (
              <Link key={item.to} to={item.to} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${active ? "border-primary/25 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border/60 p-3">
          <div className="mb-2 min-w-0 px-3">
            <div className="truncate text-sm font-medium text-foreground">{user.user_metadata?.full_name ?? "Student"}</div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={async () => { await signOut(); nav({ to: "/" }); }}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl lg:hidden">
        <div className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4">
          <Link to="/dashboard" className="flex min-w-0 items-center gap-2 font-display text-lg font-bold">
            <img src={logoAsset.url} alt="Cogni" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            <span className="truncate">Cogni</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1">
            <Button asChild variant="ghost" size="icon" title="Create deck"><Link to="/create"><Upload /></Link></Button>
            <Button asChild variant="ghost" size="icon" title="Program chat"><Link to="/chat"><MessageCircle /></Link></Button>
            <Button asChild variant="ghost" size="icon" title="Profile"><Link to="/profile"><Menu /></Link></Button>
            {isAdmin && <Button asChild variant="ghost" size="icon" title="Admin dashboard"><Link to="/admin"><ShieldCheck /></Link></Button>}
          </div>
        </div>
      </header>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-display text-xl font-bold">
          <img src={logoAsset.url} alt="Cogni" className="h-9 w-9 rounded-lg object-cover shadow-brand" />
          Cogni
        </Link>
        <Button asChild><Link to="/login">Sign in</Link></Button>
      </div>
    </header>
  );
}
