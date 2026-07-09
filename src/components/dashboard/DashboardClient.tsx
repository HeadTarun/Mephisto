"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";

type Stats = {
  tasksPerStatus: Array<{ status: string; count: number }>;
  hoursByAssignee: Array<{ assignee: string; hours: number }>;
  completedThisWeek: number;
  week: { start: string; end: string };
};

type Activity = {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
  users?: { name: string } | null;
  tasks?: { title: string } | null;
};

export default function DashboardClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [statsResult, activityResult] = await Promise.all([
        apiFetch<Stats>("/api/stats"),
        apiFetch<{ activity: Activity[] }>("/api/activity"),
      ]);

      if (!statsResult.ok) {
        setError(statsResult.error);
        return;
      }
      if (!activityResult.ok) {
        setError(activityResult.error);
        return;
      }

      setStats(statsResult.data);
      setActivity(activityResult.data.activity);
    }

    void load();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">Sprintly Dashboard</h1>
            <p className="text-sm text-slate-500">Delivery health and recent activity</p>
          </div>
          <Link className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" href="/board">
            Board
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-2">
        {error ? <div className="rounded-lg bg-red-50 p-4 text-red-700 lg:col-span-2">{error}</div> : null}
        {!stats ? <div className="rounded-lg bg-white p-8 text-center text-slate-500 lg:col-span-2">Loading dashboard...</div> : null}

        {stats ? (
          <>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-4 font-bold">Tasks per status</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.tasksPerStatus}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="status" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0891b2" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-4 font-bold">Hours by assignee</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.hoursByAssignee}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="assignee" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="hours" fill="#0f172a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
              <h2 className="font-bold">Completed this week</h2>
              <p className="mt-2 text-4xl font-bold text-emerald-700">{stats.completedThisWeek}h</p>
              <p className="text-sm text-slate-500">
                {stats.week.start} to {stats.week.end}
              </p>
            </div>
          </>
        ) : null}

        <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-4 font-bold">Recent activity</h2>
          <div className="space-y-2">
            {activity.length ? activity.map((item) => (
              <div key={item.id} className="rounded-md bg-slate-50 p-3 text-sm">
                <span className="font-semibold">{item.users?.name ?? "System"}</span>{" "}
                {item.action} {item.tasks?.title ?? "the board"}{" "}
                {item.from_status || item.to_status ? (
                  <span className="text-slate-500">
                    ({item.from_status ?? "-"} → {item.to_status ?? "-"})
                  </span>
                ) : null}
              </div>
            )) : <p className="text-sm text-slate-500">No activity yet.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}
