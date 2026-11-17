import { Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { AppHeader } from "./app-header";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
  );
  if (!user) return <Navigate to="/login" />;
  return (
    <div className="min-h-screen bg-grid lg:flex">
      <AppHeader />
      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">{children}</main>
    </div>
  );
}
