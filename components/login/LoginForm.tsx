"use client";

// app/login/login-form.tsx
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES } from "@/lib/auth-config";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (loading) return;
    if (!username || !password) {
      setError("Enter your username and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign in failed.");
        return;
      }
      toast.success(`Signed in as ${data.role}`);
      router.push(redirectTo || data.redirect || "/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-sm border-border/60 shadow-sm">
      <CardHeader className="space-y-1">
        {/* Brand mark on mobile, where the left panel is hidden */}
        <div className="mb-2 font-[family-name:var(--font-cormorant)] text-xl lg:hidden">
          Omnia Finance OS
        </div>
        <CardTitle className="font-[family-name:var(--font-cormorant)] text-2xl">
          Sign in
        </CardTitle>
        <CardDescription>Use your team credentials to continue.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Role is a convenience prefill — auth still verifies username+password
            server-side, so picking a role you don't have credentials for fails. */}
        <div className="space-y-2">
          <Label htmlFor="role">Team</Label>
          <Select value={username} onValueChange={setUsername}>
            <SelectTrigger id="role">
              <SelectValue placeholder="Select your team" />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r.role} value={r.role}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="pr-10"
              aria-invalid={!!error}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Button className="w-full" onClick={submit} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}