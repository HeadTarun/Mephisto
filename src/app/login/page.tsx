"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";

type AuthResponse = {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
};

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("manager@sprintly.local");
  const [password, setPassword] = useState("ManagerPass123!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await apiFetch<AuthResponse>(`/api/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify(
        mode === "signup"
          ? { name, email, password }
          : { email, password },
      ),
    });

    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    router.push(searchParams.get("next") ?? "/board");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen bg-slate-950 text-white">
      <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Sprintly
          </p>
          <h1 className="max-w-2xl text-5xl font-semibold tracking-normal">
            Run the sprint board with rules your team can trust.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-slate-300">
            Sign in with one of the seeded accounts after running the Supabase SQL,
            then import the sample board and demo protected workflow rules.
          </p>
          <div className="grid max-w-xl gap-3 text-sm text-slate-300 sm:grid-cols-3">
            <SeedAccount label="Admin" email="admin@sprintly.local" password="AdminPass123!" />
            <SeedAccount label="Manager" email="manager@sprintly.local" password="ManagerPass123!" />
            <SeedAccount label="Member" email="member@sprintly.local" password="MemberPass123!" />
          </div>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-white/10 bg-white p-6 text-slate-950 shadow-2xl">
          <div className="mb-6 flex rounded-md bg-slate-100 p-1">
            {(["login", "signup"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`flex-1 rounded px-3 py-2 text-sm font-semibold ${
                  mode === item ? "bg-slate-950 text-white" : "text-slate-600"
                }`}
              >
                {item === "login" ? "Login" : "Signup"}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {mode === "signup" ? (
              <label className="block text-sm font-medium">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  required
                />
              </label>
            ) : null}
            <label className="block text-sm font-medium">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                required
              />
            </label>
          </div>

          {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <button
            disabled={loading}
            className="mt-6 w-full rounded-md bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
          >
            {loading ? "Working..." : mode === "login" ? "Login" : "Create member account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function SeedAccount({ label, email, password }: { label: string; email: string; password: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/5 p-3">
      <p className="font-semibold text-white">{label}</p>
      <p>{email}</p>
      <p>{password}</p>
    </div>
  );
}
