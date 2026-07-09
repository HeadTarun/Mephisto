"use client";

import Link from "next/link";
import { CSS } from "@dnd-kit/utilities";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { currentWeekBounds, isWithinIsoRange } from "@/lib/dates";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type AuthUser,
  type TaskRow,
  type TaskStatus,
} from "@/lib/types";
import { ToastMessage, Toasts } from "@/components/Toast";
import { useLive } from "@/components/useLive";

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

type TaskResponse = { tasks: TaskRow[] };
type UserResponse = { user: AuthUser };
type UsersResponse = { assignees: string[] };
type Health = { issuesFixed: number; tasksLoaded: number; message: string };
type ActivityItem = {
  id: string;
  task_id: string | null;
  user_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
  users?: { name: string; avatar: string | null } | null;
  tasks?: { title: string } | null;
};

/* ═══════════════════════════════════════════════════════════
   Constants & helpers
   ═══════════════════════════════════════════════════════════ */

const COLUMN_THEME: Record<TaskStatus, { accent: string; bg: string; headerBg: string; icon: string }> = {
  Backlog: {
    accent: "var(--col-backlog)",
    bg: "rgba(148,163,184,0.06)",
    headerBg: "linear-gradient(135deg, #94a3b8 0%, #64748b 100%)",
    icon: "📋",
  },
  "In Progress": {
    accent: "var(--col-progress)",
    bg: "rgba(59,130,246,0.05)",
    headerBg: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    icon: "⚡",
  },
  Review: {
    accent: "var(--col-review)",
    bg: "rgba(245,158,11,0.05)",
    headerBg: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
    icon: "🔍",
  },
  Done: {
    accent: "var(--col-done)",
    bg: "rgba(16,185,129,0.05)",
    headerBg: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    icon: "✅",
  },
};

const WIP_LIMITS: Partial<Record<TaskStatus, number>> = {
  "In Progress": 5,
  Review: 3,
};

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  high: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", label: "High" },
  med: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", label: "Med" },
  low: { color: "#10b981", bg: "rgba(16,185,129,0.1)", label: "Low" },
};

const statusIds = new Set<string>(TASK_STATUSES);

/* ─── SVG icons ────────────────────────────────────────────── */

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="4" cy="2" r="1.3" />
      <circle cx="10" cy="2" r="1.3" />
      <circle cx="4" cy="7" r="1.3" />
      <circle cx="10" cy="7" r="1.3" />
      <circle cx="4" cy="12" r="1.3" />
      <circle cx="10" cy="12" r="1.3" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   Root board component
   ═══════════════════════════════════════════════════════════ */

export default function BoardClient() {
  const router = useRouter();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [assignees, setAssignees] = useState<string[]>(["Unassigned"]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("All");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [droppedId, setDroppedId] = useState<string | null>(null);
  const dragStartTasksRef = useRef<TaskRow[] | null>(null);
  const dragDestinationRef = useRef<{ status: TaskStatus; position: number } | null>(null);
  const searchTimerRef = useRef<number | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /* ── search debounce ────────────────────────────────────── */
  useEffect(() => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); };
  }, [search]);

  const showToast = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    const id = Date.now();
    setToasts((items) => [...items, { id, text, tone }]);
    window.setTimeout(
      () => setToasts((items) => items.filter((item) => item.id !== id)),
      3500,
    );
  }, []);

  const load = useCallback(async () => {
    const [taskResult, userResult, usersResult] = await Promise.all([
      apiFetch<TaskResponse>("/api/tasks"),
      apiFetch<UserResponse>("/api/auth/me"),
      apiFetch<UsersResponse>("/api/users"),
    ]);

    if (!taskResult.ok) {
      setError(taskResult.error);
      setLoading(false);
      return;
    }
    if (userResult.ok) {
      setUser(userResult.data.user);
    }
    if (usersResult.ok) {
      setAssignees(usersResult.data.assignees);
    }

    setTasks(sortTasks(taskResult.data.tasks));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  useLive(load, !loading && !isDragging);

  const filteredTasks = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    const today = new Date().toISOString().slice(0, 10);
    return tasks.filter((task) => {
      const matchesSearch = !query || task.title.toLowerCase().includes(query);
      const matchesAssignee =
        assigneeFilter === "All" || task.assignee === assigneeFilter;
      const matchesOverdue =
        !overdueOnly ||
        Boolean(task.due_date && task.due_date < today && task.status !== "Done");
      return matchesSearch && matchesAssignee && matchesOverdue;
    });
  }, [assigneeFilter, overdueOnly, debouncedSearch, tasks]);

  async function importTasks() {
    setLoading(true);
    const result = await apiFetch<Health>("/api/import", { method: "POST" });
    setLoading(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setHealth(result.data);
    showToast(result.data.message, "success");
    await load();
  }

  async function resetBoard() {
    setLoading(true);
    const result = await apiFetch<Health>("/api/board/reset", { method: "POST" });
    setLoading(false);
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setHealth(result.data);
    showToast("Board reset", "success");
    await load();
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /* ── Drag handlers ──────────────────────────────────────── */

  function onDragStart(event: DragStartEvent) {
    const task = tasks.find((item) => item.id === String(event.active.id));
    setActiveTask(task ?? null);
    dragStartTasksRef.current = tasks;
    dragDestinationRef.current = task
      ? { status: task.status, position: task.position }
      : null;
    setIsDragging(true);
  }

  function onDragOver(event: DragOverEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;

    if (!overId || activeId === overId) {
      return;
    }

    setTasks((current) => {
      const movingTask = current.find((task) => task.id === activeId);
      if (!movingTask) {
        return current;
      }

      const toStatus = getDropStatus(overId, current);
      if (!toStatus) {
        return current;
      }

      if (
        user?.role === "member" &&
        (movingTask.status === "Done" || toStatus === "Done")
      ) {
        return current;
      }

      const toPosition = getDropPosition({
        activeId,
        overId,
        toStatus,
        tasks: current,
      });

      dragDestinationRef.current = { status: toStatus, position: toPosition };

      if (movingTask.status === toStatus && movingTask.position === toPosition) {
        return current;
      }

      return applyLocalMove(current, activeId, toStatus, toPosition);
    });
  }

  async function onDragEnd(event: DragEndEvent) {
    setIsDragging(false);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const originalTasks = dragStartTasksRef.current ?? tasks;
    const movingTask = originalTasks.find((task) => task.id === activeId);
    setActiveTask(null);
    dragStartTasksRef.current = null;

    if (!movingTask || !overId) {
      setTasks(originalTasks);
      return;
    }

    const toStatus = dragDestinationRef.current?.status ?? getDropStatus(overId, tasks);
    if (!toStatus) {
      setTasks(originalTasks);
      return;
    }

    if (user?.role === "member" && (movingTask.status === "Done" || toStatus === "Done")) {
      setTasks(originalTasks);
      showToast("Members cannot move tasks into or out of Done.", "error");
      return;
    }

    const toPosition =
      dragDestinationRef.current?.position ??
      getDropPosition({
        activeId,
        overId,
        toStatus,
        tasks,
      });
    dragDestinationRef.current = null;

    const result = await apiFetch<{ task: TaskRow }>("/api/tasks/move", {
      method: "PATCH",
      body: JSON.stringify({ id: activeId, toStatus, toPosition }),
    });

    if (!result.ok) {
      setTasks(originalTasks);
      showToast(result.error, "error");
      return;
    }

    /* trigger drop-bounce animation */
    setDroppedId(activeId);
    window.setTimeout(() => setDroppedId(null), 350);

    showToast(
      movingTask.status === toStatus ? "Card reordered" : `Moved to ${toStatus}`,
      "success",
    );
    await load();
  }

  async function deleteTask(task: TaskRow) {
    const result = await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    setSelectedTask(null);
    showToast("Task deleted", "success");
    await load();
  }

  const canManage = user?.role === "admin" || user?.role === "manager";

  /* ── Render ─────────────────────────────────────────────── */

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* ─── Header ─────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b"
        style={{
          borderColor: "var(--border)",
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <div
              className="grid h-9 w-9 place-items-center rounded-xl text-lg font-extrabold text-white"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              M
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight" style={{ color: "var(--fg)" }}>
                Mephisto
              </h1>
              <p className="text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
                {user ? `${user.name} · ${user.role}` : "Loading session…"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health ? (
              <span
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: "var(--success-glow)",
                  color: "#047857",
                  border: "1px solid rgba(16,185,129,0.25)",
                }}
              >
                <span style={{ fontSize: 11 }}>✓</span>
                {health.message}
              </span>
            ) : null}
            <Link
              className="rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md"
              href="/dashboard"
              style={{
                border: "1px solid var(--border)",
                color: "var(--fg)",
                background: "var(--bg-card)",
              }}
            >
              📊 Dashboard
            </Link>
            {user ? (
              <TeamUpdatesBell
                user={user}
                onToast={showToast}
                refreshToken={tasks
                  .map((task) => `${task.id}:${task.updated_at}:${task.assignee}`)
                  .join("|")}
              />
            ) : null}
            <button
              onClick={importTasks}
              className="rounded-lg px-3.5 py-2 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              Import
            </button>
            <button
              onClick={resetBoard}
              className="rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md"
              style={{
                border: "1px solid var(--border)",
                color: "var(--fg)",
                background: "var(--bg-card)",
              }}
            >
              Reset
            </button>
            <button
              onClick={logout}
              className="rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md"
              style={{
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
                background: "var(--bg-card)",
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] space-y-5 px-5 py-6">
        {/* ─── Filters ──────────────────────────────────────── */}
        <div
          className="grid items-center gap-3 rounded-2xl p-4 md:grid-cols-[1fr_200px_160px]"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--fg-muted)" }}>
              🔍
            </span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tasks…"
              className="w-full rounded-xl py-2.5 pl-9 pr-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2"
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--fg)",
              }}
            />
          </div>
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="rounded-xl py-2.5 px-3 text-sm transition-all duration-200 focus:outline-none focus:ring-2"
            style={{
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          >
            <option>All</option>
            {assignees.map((assignee) => (
              <option key={assignee}>{assignee}</option>
            ))}
          </select>
          <label className="flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none" style={{ color: "var(--fg)" }}>
            <div className="relative">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={(event) => setOverdueOnly(event.target.checked)}
                className="peer sr-only"
              />
              <div
                className="h-5 w-9 rounded-full transition-colors duration-200 peer-checked:bg-red-500"
                style={{ background: overdueOnly ? undefined : "#cbd5e1" }}
              />
              <div
                className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 peer-checked:translate-x-4"
              />
            </div>
            Overdue only
          </label>
        </div>

        {/* ─── Create task (managers only) ───────────────────── */}
        {canManage ? (
          <TaskForm assignees={assignees} onDone={load} onToast={showToast} />
        ) : null}

        {/* ─── Error state ───────────────────────────────────── */}
        {error ? (
          <div
            className="rounded-2xl p-4 text-sm font-medium"
            style={{
              background: "var(--danger-glow)",
              color: "var(--danger)",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
          >
            {error}
          </div>
        ) : null}

        {/* ─── Loading skeletons ─────────────────────────────── */}
        {loading ? (
          <div className="grid gap-5 lg:grid-cols-4">
            {TASK_STATUSES.map((status) => (
              <div
                key={status}
                className="rounded-2xl p-4"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}
              >
                <div className="skeleton-shimmer mb-4 h-8 w-24 rounded-lg" />
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-2 rounded-xl p-3" style={{ background: "var(--bg)" }}>
                      <div className="skeleton-shimmer h-4 w-3/4 rounded" />
                      <div className="skeleton-shimmer h-3 w-full rounded" />
                      <div className="flex gap-2">
                        <div className="skeleton-shimmer h-5 w-16 rounded-full" />
                        <div className="skeleton-shimmer h-5 w-12 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* ─── Board ─────────────────────────────────────────── */}
        {!loading ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              if (dragStartTasksRef.current) {
                setTasks(dragStartTasksRef.current);
              }
              dragStartTasksRef.current = null;
              dragDestinationRef.current = null;
              setActiveTask(null);
              setIsDragging(false);
            }}
          >
            <div className="grid gap-5 lg:grid-cols-4">
              {TASK_STATUSES.map((status) => (
                <Column
                  key={status}
                  status={status}
                  tasks={tasks.filter((task) => task.status === status)}
                  visibleTasks={filteredTasks.filter((task) => task.status === status)}
                  user={user}
                  activeTask={activeTask}
                  droppedId={droppedId}
                  onSelect={setSelectedTask}
                />
              ))}
            </div>
            <DragOverlay
              dropAnimation={{
                duration: 280,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {activeTask ? (
                <div className="drag-overlay-card">
                  <TaskCardContent task={activeTask} isOverlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </section>

      {/* ─── Task detail modal ───────────────────────────────── */}
      {selectedTask ? (
        <TaskDetail
          task={selectedTask}
          assignees={assignees}
          canManage={canManage}
          onClose={() => setSelectedTask(null)}
          onDelete={deleteTask}
          onDone={async () => {
            setSelectedTask(null);
            await load();
          }}
          onToast={showToast}
        />
      ) : null}

      <Toasts messages={toasts} />
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════
   Notification bell
   ═══════════════════════════════════════════════════════════ */

function TeamUpdatesBell({
  user,
  onToast,
  refreshToken,
}: {
  user: AuthUser;
  onToast: (text: string, tone?: ToastMessage["tone"]) => void;
  refreshToken: string;
}) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellAnimate, setBellAnimate] = useState(false);
  const latestSeenRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  const loadActivity = useCallback(async () => {
    const result = await apiFetch<{ activity: ActivityItem[] }>("/api/activity");
    if (!result.ok) {
      return;
    }

    const nextActivity = result.data.activity;
    const newest = nextActivity[0]?.created_at ?? null;
    const previousNewest = latestSeenRef.current;

    if (initializedRef.current && previousNewest) {
      const newItems = nextActivity.filter((item) => item.created_at > previousNewest);
      const otherUserItems = newItems.filter((item) => item.user_id !== user.userId);

      if (otherUserItems.length > 0) {
        setUnread((count) => count + otherUserItems.length);
        setBellAnimate(true);
        window.setTimeout(() => setBellAnimate(false), 600);
      }

      for (const item of otherUserItems.slice().reverse()) {
        if (item.action === "assigned" && item.to_status === user.name) {
          onToast(`Assigned to you: ${item.tasks?.title ?? "task"}`, "success");
        } else if (item.action !== "reordered") {
          onToast(
            `${item.users?.name ?? "Someone"} ${formatActivity(item)}${
              item.tasks?.title ? `: ${item.tasks.title}` : ""
            }`,
          );
        }
      }
    }

    initializedRef.current = true;
    latestSeenRef.current = newest;
    setActivity(nextActivity);
  }, [onToast, user.name, user.userId]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity, refreshToken]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadActivity();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [loadActivity]);

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((value) => !value);
          setUnread(0);
        }}
        className={`relative rounded-lg px-3.5 py-2 text-sm font-semibold transition-all duration-200 hover:shadow-md ${bellAnimate ? "bell-ring" : ""}`}
        style={{
          border: "1px solid var(--border)",
          color: "var(--fg)",
          background: "var(--bg-card)",
        }}
      >
        🔔 Team
        {unread > 0 ? (
          <span
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs font-bold text-white"
            style={{
              background: "linear-gradient(135deg, #ef4444, #dc2626)",
              boxShadow: "0 2px 8px rgba(239,68,68,0.4)",
              animation: "scaleIn 200ms cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-12 z-50 w-[340px] rounded-2xl p-4 shadow-2xl"
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            animation: "scaleIn 200ms cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold" style={{ color: "var(--fg)" }}>Team Updates</p>
            <button
              onClick={() => void loadActivity()}
              className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors duration-200"
              style={{
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
              }}
            >
              Refresh
            </button>
          </div>
          <div className="max-h-96 space-y-2 overflow-auto">
            {activity.length ? (
              activity.slice(0, 20).map((item) => {
                const assignedToMe = item.action === "assigned" && item.to_status === user.name;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl p-3 text-sm transition-colors duration-200"
                    style={{
                      background: assignedToMe ? "var(--success-glow)" : "var(--bg)",
                      border: assignedToMe ? "1px solid rgba(16,185,129,0.2)" : "1px solid transparent",
                    }}
                  >
                    <p style={{ color: "var(--fg)" }}>
                      <span className="font-semibold">{item.users?.name ?? "System"}</span>{" "}
                      <span style={{ color: "var(--fg-muted)" }}>{formatActivity(item)}</span>
                      {assignedToMe ? (
                        <span className="ml-1.5 rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--success)", color: "white" }}>
                          you
                        </span>
                      ) : ""}
                    </p>
                    {item.tasks?.title ? (
                      <p className="mt-1 text-xs truncate" style={{ color: "var(--fg-muted)" }}>{item.tasks.title}</p>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p
                className="rounded-xl p-4 text-center text-sm"
                style={{ color: "var(--fg-muted)", background: "var(--bg)" }}
              >
                No team updates yet.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatActivity(item: ActivityItem) {
  if (item.action === "assigned") {
    return `assigned ${item.to_status ?? "someone"}`;
  }
  if (item.action === "unassigned") {
    return "unassigned";
  }
  if (item.action === "moved" || item.action === "completed") {
    return `${item.action} ${item.from_status ?? ""} → ${item.to_status ?? ""}`.trim();
  }
  if (item.action === "imported") {
    return "imported the board";
  }
  if (item.action === "reset") {
    return "reset the board";
  }

  return item.action;
}

/* ═══════════════════════════════════════════════════════════
   Column
   ═══════════════════════════════════════════════════════════ */

function Column({
  status,
  tasks,
  visibleTasks,
  user,
  activeTask,
  droppedId,
  onSelect,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  visibleTasks: TaskRow[];
  user: AuthUser | null;
  activeTask: TaskRow | null;
  droppedId: string | null;
  onSelect: (task: TaskRow) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: { type: "column", status },
  });
  const theme = COLUMN_THEME[status];
  const week = currentWeekBounds();
  const hours = tasks.reduce((sum, task) => sum + task.estimate_hours, 0);
  const doneWeekHours =
    status === "Done"
      ? tasks
          .filter((task) => isWithinIsoRange(task.completed_date, week.start, week.end))
          .reduce((sum, task) => sum + task.estimate_hours, 0)
      : null;
  const locked = user?.role === "member" && status === "Done";
  const blockedPreview =
    isOver &&
    user?.role === "member" &&
    activeTask &&
    (activeTask.status === "Done" || status === "Done");
  const wipLimit = WIP_LIMITS[status];
  const wipRatio = wipLimit ? tasks.length / wipLimit : 0;

  return (
    <section
      ref={setNodeRef}
      className={`rounded-2xl transition-all duration-300 ${
        isOver && !blockedPreview ? "column-drop-active" : ""
      } ${blockedPreview ? "column-drop-blocked" : ""}`}
      style={{
        minHeight: 460,
        background: theme.bg,
        border: `1px solid ${isOver ? (blockedPreview ? "var(--danger)" : "var(--accent)") : "var(--border)"}`,
        padding: 14,
      }}
    >
      {/* Column header */}
      <div
        className="mb-4 rounded-xl px-3.5 py-2.5"
        style={{
          background: theme.headerBg,
          boxShadow: `0 2px 12px ${theme.accent}33`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{theme.icon}</span>
            <h2 className="text-sm font-bold text-white">
              {status}
              {locked ? " 🔒" : ""}
            </h2>
          </div>
          <span
            className="grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold"
            style={{
              background: "rgba(255,255,255,0.25)",
              color: "white",
            }}
          >
            {tasks.length}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-xs text-white/80">
          <span>{hours}h est.</span>
          {doneWeekHours !== null ? <span>{doneWeekHours}h this week</span> : null}
        </div>
        {/* WIP progress bar */}
        {wipLimit ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(wipRatio * 100, 100)}%`,
                background: wipRatio >= 1 ? "#ef4444" : wipRatio >= 0.8 ? "#f59e0b" : "rgba(255,255,255,0.7)",
              }}
            />
          </div>
        ) : null}
      </div>

      {/* Cards list */}
      <SortableContext
        items={visibleTasks.map((task) => task.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3">
          {visibleTasks.length ? (
            visibleTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                user={user}
                isDropped={droppedId === task.id}
                onSelect={onSelect}
              />
            ))
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-xl p-8 text-center"
              style={{
                border: "2px dashed var(--border)",
                color: "var(--fg-muted)",
                animation: isOver ? undefined : "float 3s ease-in-out infinite",
              }}
            >
              <span className="text-2xl" style={{ opacity: 0.5 }}>📥</span>
              <span className="text-xs font-medium">Drop cards here</span>
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   Task card (sortable wrapper)
   ═══════════════════════════════════════════════════════════ */

function TaskCard({
  task,
  user,
  isDropped,
  onSelect,
}: {
  task: TaskRow;
  user: AuthUser | null;
  isDropped: boolean;
  onSelect: (task: TaskRow) => void;
}) {
  const doneLocked = user?.role === "member" && task.status === "Done";
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: doneLocked,
    data: { type: "task", task },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.22,1,0.36,1)",
  };

  if (isDragging) {
    /* Placeholder ghost */
    return (
      <div
        ref={setNodeRef}
        style={{ ...style, height: 100 }}
        className="drop-placeholder"
      />
    );
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`group rounded-xl transition-all duration-200 ${
        isDropped ? "card-dropped" : ""
      }`}
    >
      <TaskCardContent
        task={task}
        locked={doneLocked}
        onSelect={onSelect}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════
   Task card content (shared by card + overlay)
   ═══════════════════════════════════════════════════════════ */

function TaskCardContent({
  task,
  locked = false,
  isOverlay = false,
  onSelect,
  dragAttributes,
  dragListeners,
}: {
  task: TaskRow;
  locked?: boolean;
  isOverlay?: boolean;
  onSelect?: (task: TaskRow) => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = task.due_date && task.due_date < today && task.status !== "Done";
  const pri = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.low;

  return (
    <div
      className={`rounded-xl transition-all duration-200 ${
        isOverlay
          ? ""
          : "hover:-translate-y-0.5 hover:shadow-lg cursor-default"
      }`}
      style={{
        background: isOverlay ? "var(--bg-card)" : "var(--bg-card)",
        border: isOverlay ? "none" : "1px solid var(--border)",
        borderLeft: `4px solid ${pri.color}`,
        padding: "14px 14px 12px",
        boxShadow: isOverlay
          ? "0 20px 50px rgba(0,0,0,0.18)"
          : "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* Top row: grip + title + warning */}
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          disabled={locked || isOverlay}
          className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-lg transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            color: "var(--fg-muted)",
            cursor: locked || isOverlay ? undefined : "grab",
          }}
          title={locked ? "Done cards are locked for members" : "Drag card"}
          {...dragAttributes}
          {...dragListeners}
        >
          <GripIcon />
        </button>
        <button
          onClick={() => onSelect?.(task)}
          className="block min-w-0 flex-1 text-left"
          type="button"
        >
          <div className="flex items-start justify-between gap-2">
            <h3
              className="text-sm font-semibold leading-5 line-clamp-2"
              style={{ color: "var(--fg)" }}
            >
              {task.title}
            </h3>
            {task.has_warning ? (
              <span
                className="flex-none rounded-full px-1.5 py-0.5 text-xs font-bold"
                style={{
                  background: "rgba(245,158,11,0.15)",
                  color: "#d97706",
                }}
                title="Imported with warning"
              >
                ⚠
              </span>
            ) : null}
          </div>
          {task.description ? (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: "var(--fg-muted)" }}
            >
              {task.description}
            </p>
          ) : null}
        </button>
      </div>

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* Assignee */}
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium"
          style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)" }}
        >
          <span
            className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            {task.assignee.charAt(0).toUpperCase()}
          </span>
          {task.assignee}
        </span>

        {/* Priority */}
        <span
          className="rounded-full px-2 py-1 text-xs font-semibold"
          style={{ background: pri.bg, color: pri.color }}
        >
          {pri.label}
        </span>

        {/* Hours */}
        <span
          className="rounded-full px-2 py-1 text-xs font-medium"
          style={{ background: "var(--bg)", color: "var(--fg-muted)", border: "1px solid var(--border)" }}
        >
          {task.estimate_hours}h
        </span>

        {/* Due date */}
        {task.due_date ? (
          <span
            className="rounded-full px-2 py-1 text-xs font-medium"
            style={{
              background: overdue ? "var(--danger-glow)" : "var(--bg)",
              color: overdue ? "var(--danger)" : "var(--fg-muted)",
              border: overdue ? "1px solid rgba(239,68,68,0.2)" : "1px solid var(--border)",
            }}
          >
            {overdue ? "🔥 " : ""}{task.due_date}
          </span>
        ) : null}
      </div>

      {/* Labels */}
      {task.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{
                background: "rgba(99,102,241,0.08)",
                color: "var(--accent)",
                border: "1px solid rgba(99,102,241,0.15)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

function getDropStatus(overId: string, tasks: TaskRow[]): TaskStatus | null {
  if (statusIds.has(overId)) {
    return overId as TaskStatus;
  }

  return tasks.find((task) => task.id === overId)?.status ?? null;
}

function getDropPosition({
  activeId,
  overId,
  toStatus,
  tasks,
}: {
  activeId: string;
  overId: string;
  toStatus: TaskStatus;
  tasks: TaskRow[];
}) {
  const destinationTasks = sortTasks(
    tasks.filter((task) => task.status === toStatus && task.id !== activeId),
  );

  if (statusIds.has(overId)) {
    return destinationTasks.length;
  }

  const overIndex = destinationTasks.findIndex((task) => task.id === overId);
  return overIndex === -1 ? destinationTasks.length : overIndex;
}

function applyLocalMove(
  currentTasks: TaskRow[],
  activeId: string,
  toStatus: TaskStatus,
  toPosition: number,
) {
  const movingTask = currentTasks.find((task) => task.id === activeId);
  if (!movingTask) {
    return currentTasks;
  }

  const nextTasks = currentTasks.filter((task) => task.id !== activeId);
  const movedTask: TaskRow = {
    ...movingTask,
    status: toStatus,
    position: toPosition,
    completed_date:
      toStatus === "Done" ? new Date().toISOString().slice(0, 10) : null,
  };
  const destination = sortTasks(nextTasks.filter((task) => task.status === toStatus));
  destination.splice(Math.min(toPosition, destination.length), 0, movedTask);
  const reindexedDestination = destination.map((task, index) => ({
    ...task,
    position: index,
  }));

  const sourceStatus = movingTask.status;
  const source =
    sourceStatus === toStatus
      ? []
      : sortTasks(nextTasks.filter((task) => task.status === sourceStatus)).map(
          (task, index) => ({ ...task, position: index }),
        );

  const untouched = nextTasks.filter(
    (task) => task.status !== toStatus && task.status !== sourceStatus,
  );

  return sortTasks([...untouched, ...source, ...reindexedDestination]);
}

function sortTasks(items: TaskRow[]) {
  return [...items].sort((left, right) => {
    const statusDelta =
      TASK_STATUSES.indexOf(left.status) - TASK_STATUSES.indexOf(right.status);
    return statusDelta || left.position - right.position || left.id.localeCompare(right.id);
  });
}

/* ═══════════════════════════════════════════════════════════
   Create task form
   ═══════════════════════════════════════════════════════════ */

function TaskForm({
  assignees,
  onDone,
  onToast,
}: {
  assignees: string[];
  onDone: () => Promise<void>;
  onToast: (text: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [open, setOpen] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const labels = String(form.get("labels") ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const result = await apiFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        status: form.get("status"),
        assignee: form.get("assignee"),
        priority: form.get("priority"),
        due_date: form.get("due_date") || null,
        estimate_hours: Number(form.get("estimate_hours") || 0),
        labels,
      }),
    });

    if (!result.ok) {
      onToast(result.error, "error");
      return;
    }
    event.currentTarget.reset();
    setOpen(false);
    onToast("Task created", "success");
    await onDone();
  }

  const inputStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--fg)",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <button
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
        style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
      >
        {open ? "✕ Close" : "＋ Create task"}
      </button>
      {open ? (
        <form
          onSubmit={submit}
          className="mt-4 grid gap-3 md:grid-cols-3"
          style={{ animation: "scaleIn 200ms cubic-bezier(0.22,1,0.36,1)" }}
        >
          <input name="title" placeholder="Title" style={inputStyle} required />
          <select name="status" style={inputStyle}>
            {TASK_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <select name="assignee" style={inputStyle}>
            {assignees.map((assignee) => (
              <option key={assignee}>{assignee}</option>
            ))}
          </select>
          <select name="priority" style={inputStyle}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
          <input name="due_date" type="date" style={inputStyle} />
          <input name="estimate_hours" type="number" min="0" placeholder="Hours" style={inputStyle} />
          <input
            name="labels"
            placeholder="Labels, comma separated"
            style={{ ...inputStyle, gridColumn: "1 / -1" }}
          />
          <textarea
            name="description"
            placeholder="Description"
            style={{ ...inputStyle, gridColumn: "1 / -1", minHeight: 80 }}
          />
          <button
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
            style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)", gridColumn: "1 / -1" }}
          >
            Create
          </button>
        </form>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Task detail modal
   ═══════════════════════════════════════════════════════════ */

function TaskDetail({
  task,
  assignees,
  canManage,
  onClose,
  onDelete,
  onDone,
  onToast,
}: {
  task: TaskRow;
  assignees: string[];
  canManage: boolean;
  onClose: () => void;
  onDelete: (task: TaskRow) => Promise<void>;
  onDone: () => Promise<void>;
  onToast: (text: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; text: string; created_at: string }>
  >([]);

  useEffect(() => {
    void apiFetch<{ comments: Array<{ id: string; text: string; created_at: string }> }>(
      `/api/comments?taskId=${task.id}`,
    ).then((result) => {
      if (result.ok) {
        setComments(result.data.comments);
      }
    });
  }, [task.id]);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const labels = String(form.get("labels") ?? "")
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const result = await apiFetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        assignee: form.get("assignee"),
        priority: form.get("priority"),
        due_date: form.get("due_date") || null,
        estimate_hours: Number(form.get("estimate_hours") || 0),
        labels,
      }),
    });
    if (!result.ok) {
      onToast(result.error, "error");
      return;
    }
    onToast("Task updated", "success");
    await onDone();
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = String(form.get("comment") ?? "");
    const result = await apiFetch("/api/comments", {
      method: "POST",
      body: JSON.stringify({ taskId: task.id, text }),
    });
    if (!result.ok) {
      onToast(result.error, "error");
      return;
    }
    event.currentTarget.reset();
    const fresh = await apiFetch<{
      comments: Array<{ id: string; text: string; created_at: string }>;
    }>(`/api/comments?taskId=${task.id}`);
    if (fresh.ok) {
      setComments(fresh.data.comments);
    }
  }

  const pri = PRIORITY_CONFIG[task.priority] ?? PRIORITY_CONFIG.low;

  const inputStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--fg)",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 14,
    outline: "none",
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{
        background: "var(--overlay)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "fadeIn 200ms ease-out",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl p-6"
        style={{
          background: "var(--bg-card)",
          boxShadow: "0 25px 65px rgba(0,0,0,0.2)",
          animation: "scaleIn 250ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2
              className="text-xl font-bold leading-tight"
              style={{ color: "var(--fg)" }}
            >
              {task.title}
            </h2>
            <div className="mt-2 flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                style={{ background: COLUMN_THEME[task.status].headerBg }}
              >
                {task.status}
              </span>
              <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
                Drag the card to move it
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 flex-none place-items-center rounded-xl text-lg transition-all duration-200 hover:scale-110"
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--fg-muted)",
            }}
          >
            ✕
          </button>
        </div>

        {canManage ? (
          <form onSubmit={update} className="grid gap-3">
            <input name="title" defaultValue={task.title} style={inputStyle} required />
            <textarea
              name="description"
              defaultValue={task.description}
              style={{ ...inputStyle, minHeight: 80 }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select name="assignee" defaultValue={task.assignee} style={inputStyle}>
                {assignees.map((assignee) => (
                  <option key={assignee}>{assignee}</option>
                ))}
              </select>
              <select name="priority" defaultValue={task.priority} style={inputStyle}>
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
              <input
                name="due_date"
                type="date"
                defaultValue={task.due_date ?? ""}
                style={inputStyle}
              />
              <input
                name="estimate_hours"
                type="number"
                min="0"
                defaultValue={task.estimate_hours}
                style={inputStyle}
              />
            </div>
            <input
              name="labels"
              defaultValue={task.labels.join(", ")}
              style={inputStyle}
            />
            <div className="flex gap-2">
              <button
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #0f172a, #1e293b)" }}
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={() => void onDelete(task)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
              >
                Delete
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                style={{ background: "var(--bg)", color: "var(--fg)", border: "1px solid var(--border)" }}
              >
                <span
                  className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
                >
                  {task.assignee.charAt(0).toUpperCase()}
                </span>
                {task.assignee}
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: pri.bg, color: pri.color }}>
                {pri.label}
              </span>
              <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--bg)", color: "var(--fg-muted)", border: "1px solid var(--border)" }}>
                {task.estimate_hours}h
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "var(--fg-muted)" }}>
              {task.description || "No description"}
            </p>
          </div>
        )}

        {/* Comments */}
        <div
          className="mt-6 border-t pt-5"
          style={{ borderColor: "var(--border)" }}
        >
          <h3 className="text-sm font-bold" style={{ color: "var(--fg)" }}>
            💬 Comments
          </h3>
          <form onSubmit={addComment} className="mt-3 flex gap-2">
            <input
              name="comment"
              className="flex-1"
              placeholder="Add a comment…"
              required
              style={inputStyle}
            />
            <button
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-lg hover:brightness-110"
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
            >
              Add
            </button>
          </form>
          <div className="mt-3 space-y-2">
            {comments.length ? (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-xl p-3 text-sm"
                  style={{
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    color: "var(--fg)",
                  }}
                >
                  {comment.text}
                </div>
              ))
            ) : (
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                No comments yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
