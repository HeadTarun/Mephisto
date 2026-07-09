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
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

type TaskResponse = { tasks: TaskRow[] };
type UserResponse = { user: AuthUser };
type UsersResponse = { assignees: string[] };
type Health = { issuesFixed: number; tasksLoaded: number; message: string };

const statusTone: Record<TaskStatus, string> = {
  Backlog: "border-slate-300 bg-slate-50",
  "In Progress": "border-cyan-300 bg-cyan-50",
  Review: "border-amber-300 bg-amber-50",
  Done: "border-emerald-300 bg-emerald-50",
};

const statusIds = new Set<string>(TASK_STATUSES);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    const query = search.trim().toLowerCase();
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
  }, [assigneeFilter, overdueOnly, search, tasks]);

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

  function onDragStart(event: DragStartEvent) {
    const task = tasks.find((item) => item.id === String(event.active.id));
    setActiveTask(task ?? null);
    setIsDragging(true);
  }

  async function onDragEnd(event: DragEndEvent) {
    setIsDragging(false);
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    const movingTask = tasks.find((task) => task.id === activeId);
    setActiveTask(null);

    if (!movingTask || !overId) {
      return;
    }

    const toStatus = getDropStatus(overId, tasks);
    if (!toStatus) {
      return;
    }

    if (user?.role === "member" && (movingTask.status === "Done" || toStatus === "Done")) {
      showToast("Members cannot move tasks into or out of Done.", "error");
      return;
    }

    const toPosition = getDropPosition({
      activeId,
      overId,
      toStatus,
      tasks,
    });
    const previousTasks = tasks;
    setTasks((current) => applyLocalMove(current, activeId, toStatus, toPosition));

    const result = await apiFetch<{ task: TaskRow }>("/api/tasks/move", {
      method: "PATCH",
      body: JSON.stringify({ id: activeId, toStatus, toPosition }),
    });

    if (!result.ok) {
      setTasks(previousTasks);
      showToast(result.error, "error");
      return;
    }

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

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h1 className="text-xl font-bold">Sprintly</h1>
            <p className="text-sm text-slate-500">
              {user ? `${user.name} · ${user.role}` : "Loading session"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {health ? (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
                {health.message}
              </span>
            ) : null}
            <Link
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
              href="/dashboard"
            >
              Dashboard
            </Link>
            <button
              onClick={importTasks}
              className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white"
            >
              Import
            </button>
            <button
              onClick={resetBoard}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Reset
            </button>
            <button
              onClick={logout}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px_160px]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search task titles"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            <option>All</option>
            {assignees.map((assignee) => (
              <option key={assignee}>{assignee}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
            />
            Overdue only
          </label>
        </div>

        {canManage ? (
          <TaskForm assignees={assignees} onDone={load} onToast={showToast} />
        ) : null}

        {error ? (
          <div className="rounded-lg bg-red-50 p-4 text-red-700">{error}</div>
        ) : null}
        {loading ? (
          <div className="rounded-lg bg-white p-8 text-center text-slate-500">
            Loading board...
          </div>
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setActiveTask(null);
            setIsDragging(false);
          }}
        >
          <div className="grid gap-4 lg:grid-cols-4">
            {TASK_STATUSES.map((status) => (
              <Column
                key={status}
                status={status}
                tasks={tasks.filter((task) => task.status === status)}
                visibleTasks={filteredTasks.filter((task) => task.status === status)}
                user={user}
                activeTask={activeTask}
                onSelect={setSelectedTask}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
            {activeTask ? (
              <TaskCardContent task={activeTask} isOverlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>

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

function Column({
  status,
  tasks,
  visibleTasks,
  user,
  activeTask,
  onSelect,
}: {
  status: TaskStatus;
  tasks: TaskRow[];
  visibleTasks: TaskRow[];
  user: AuthUser | null;
  activeTask: TaskRow | null;
  onSelect: (task: TaskRow) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    data: { type: "column", status },
  });
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

  return (
    <section
      ref={setNodeRef}
      className={`min-h-[420px] rounded-lg border p-3 transition ${
        statusTone[status]
      } ${isOver ? "ring-2 ring-cyan-500" : ""} ${
        blockedPreview ? "ring-red-500" : ""
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">
            {status} {locked ? "locked" : ""}
          </h2>
          <p className="text-sm text-slate-600">
            {tasks.length} cards · {hours}h
            {doneWeekHours !== null ? ` · ${doneWeekHours}h this week` : ""}
          </p>
        </div>
      </div>
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
                onSelect={onSelect}
              />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 bg-white/70 p-5 text-center text-sm text-slate-500">
              Drop cards here
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function TaskCard({
  task,
  user,
  onSelect,
}: {
  task: TaskRow;
  user: AuthUser | null;
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
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition ${
        isDragging ? "opacity-40 ring-2 ring-cyan-500" : ""
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

  return (
    <div
      className={
        isOverlay
          ? "w-[280px] rounded-lg border border-cyan-300 bg-white p-3 shadow-2xl"
          : ""
      }
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={locked || isOverlay}
          className="mt-0.5 grid h-7 w-7 flex-none cursor-grab place-items-center rounded border border-slate-200 text-slate-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
          title={locked ? "Done cards are locked for members" : "Drag card"}
          {...dragAttributes}
          {...dragListeners}
        >
          ::
        </button>
        <button
          onClick={() => onSelect?.(task)}
          className="block min-w-0 flex-1 text-left"
          type="button"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-6">{task.title}</h3>
            {task.has_warning ? <span title="Imported with warning">!</span> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-500">
            {task.description || "No description"}
          </p>
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-slate-100 px-2 py-1">{task.assignee}</span>
        <span className="rounded bg-slate-100 px-2 py-1">{task.priority}</span>
        <span className="rounded bg-slate-100 px-2 py-1">{task.estimate_hours}h</span>
        {task.due_date ? (
          <span
            className={`rounded px-2 py-1 ${
              overdue ? "bg-red-100 text-red-700" : "bg-slate-100"
            }`}
          >
            {task.due_date}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {task.labels.map((label) => (
          <span
            key={label}
            className="rounded-full bg-cyan-50 px-2 py-1 text-xs text-cyan-700"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

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

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <button
        onClick={() => setOpen((value) => !value)}
        className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white"
      >
        {open ? "Close create form" : "Create task"}
      </button>
      {open ? (
        <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            name="title"
            placeholder="Title"
            className="rounded-md border border-slate-300 px-3 py-2"
            required
          />
          <select name="status" className="rounded-md border border-slate-300 px-3 py-2">
            {TASK_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <select
            name="assignee"
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            {assignees.map((assignee) => (
              <option key={assignee}>{assignee}</option>
            ))}
          </select>
          <select
            name="priority"
            className="rounded-md border border-slate-300 px-3 py-2"
          >
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority}>{priority}</option>
            ))}
          </select>
          <input
            name="due_date"
            type="date"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          <input
            name="estimate_hours"
            type="number"
            min="0"
            placeholder="Hours"
            className="rounded-md border border-slate-300 px-3 py-2"
          />
          <input
            name="labels"
            placeholder="Labels, comma separated"
            className="rounded-md border border-slate-300 px-3 py-2 md:col-span-3"
          />
          <textarea
            name="description"
            placeholder="Description"
            className="rounded-md border border-slate-300 px-3 py-2 md:col-span-3"
          />
          <button className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white md:col-span-3">
            Create
          </button>
        </form>
      ) : null}
    </div>
  );
}

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

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{task.title}</h2>
            <p className="text-sm text-slate-500">
              Status: {task.status}. Drag the card to move it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold"
          >
            Close
          </button>
        </div>
        {canManage ? (
          <form onSubmit={update} className="grid gap-3">
            <input
              name="title"
              defaultValue={task.title}
              className="rounded-md border border-slate-300 px-3 py-2"
              required
            />
            <textarea
              name="description"
              defaultValue={task.description}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                name="assignee"
                defaultValue={task.assignee}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                {assignees.map((assignee) => (
                  <option key={assignee}>{assignee}</option>
                ))}
              </select>
              <select
                name="priority"
                defaultValue={task.priority}
                className="rounded-md border border-slate-300 px-3 py-2"
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
              <input
                name="due_date"
                type="date"
                defaultValue={task.due_date ?? ""}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
              <input
                name="estimate_hours"
                type="number"
                min="0"
                defaultValue={task.estimate_hours}
                className="rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <input
              name="labels"
              defaultValue={task.labels.join(", ")}
              className="rounded-md border border-slate-300 px-3 py-2"
            />
            <div className="flex gap-2">
              <button className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
                Save
              </button>
              <button
                type="button"
                onClick={() => void onDelete(task)}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Delete
              </button>
            </div>
          </form>
        ) : (
          <p className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">
            {task.description}
          </p>
        )}

        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="font-bold">Comments</h3>
          <form onSubmit={addComment} className="mt-3 flex gap-2">
            <input
              name="comment"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2"
              placeholder="Add a comment"
              required
            />
            <button className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white">
              Add
            </button>
          </form>
          <div className="mt-3 space-y-2">
            {comments.length ? (
              comments.map((comment) => (
                <p key={comment.id} className="rounded-md bg-slate-50 p-3 text-sm">
                  {comment.text}
                </p>
              ))
            ) : (
              <p className="text-sm text-slate-500">No comments yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
