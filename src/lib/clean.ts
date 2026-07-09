import { parseDateString } from "@/lib/dates";
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskRow, type TaskStatus } from "@/lib/types";

type RawTask = Record<string, unknown>;

export type CleanResult = {
  cleaned: Omit<TaskRow, "created_by" | "created_at" | "updated_at">[];
  issuesFixed: number;
  tasksLoaded: number;
};

const statusLookup = new Map<string, TaskStatus>(
  TASK_STATUSES.map((status) => [status.toLowerCase(), status]),
);

export function cleanTasks(rawTasks: RawTask[]): CleanResult {
  let issuesFixed = 0;
  const latestById = new Map<string, RawTask>();

  for (const task of rawTasks) {
    const id = stringValue(task.id);
    if (!id) {
      issuesFixed += 1;
      continue;
    }

    if (latestById.has(id)) {
      issuesFixed += 1;
    }

    latestById.set(id, task);
  }

  const positionByStatus = new Map<TaskStatus, number>(
    TASK_STATUSES.map((status) => [status, 0]),
  );

  const cleaned = Array.from(latestById.values()).map((task) => {
    const statusInfo = normalizeStatus(task.status);
    if (statusInfo.fixed) {
      issuesFixed += 1;
    }

    const assigneeInfo = normalizeAssignee(task.assignee);
    if (assigneeInfo.fixed) {
      issuesFixed += 1;
    }

    const estimateInfo = normalizeEstimate(task.estimate_hours);
    if (estimateInfo.fixed) {
      issuesFixed += 1;
    }

    const statusPosition = positionByStatus.get(statusInfo.status) ?? 0;
    positionByStatus.set(statusInfo.status, statusPosition + 1);

    return {
      id: stringValue(task.id) ?? crypto.randomUUID(),
      title: stringValue(task.title) ?? "Untitled task",
      description: stringValue(task.description) ?? "",
      status: statusInfo.status,
      assignee: assigneeInfo.assignee,
      priority: normalizePriority(task.priority),
      labels: normalizeLabels(task.labels),
      due_date: parseDateString(task.due_date),
      estimate_hours: estimateInfo.estimate,
      completed_date: parseDateString(task.completed_date),
      position: statusPosition,
      has_warning: statusInfo.hasWarning,
    };
  });

  return {
    cleaned,
    issuesFixed,
    tasksLoaded: cleaned.length,
  };
}

function normalizeStatus(value: unknown): {
  status: TaskStatus;
  fixed: boolean;
  hasWarning: boolean;
} {
  const raw = stringValue(value);
  if (!raw) {
    return { status: "Backlog", fixed: true, hasWarning: true };
  }

  const normalized = statusLookup.get(raw.toLowerCase());
  if (normalized) {
    return { status: normalized, fixed: false, hasWarning: false };
  }

  return { status: "Backlog", fixed: true, hasWarning: true };
}

function normalizeAssignee(value: unknown): { assignee: string; fixed: boolean } {
  const raw = stringValue(value);

  if (!raw || raw.toLowerCase() === "n/a") {
    return { assignee: "Unassigned", fixed: true };
  }

  return { assignee: raw, fixed: false };
}

function normalizeEstimate(value: unknown): { estimate: number; fixed: boolean } {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  if (Number.isFinite(numeric) && numeric >= 0) {
    return { estimate: Math.trunc(numeric), fixed: false };
  }

  return { estimate: 0, fixed: true };
}

function normalizePriority(value: unknown): TaskPriority {
  const raw = stringValue(value)?.toLowerCase();
  return TASK_PRIORITIES.includes(raw as TaskPriority) ? (raw as TaskPriority) : "med";
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((label) => stringValue(label))
    .filter((label): label is string => Boolean(label));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : typeof value === "number"
      ? String(value)
      : null;
}
