export const USER_ROLES = ["admin", "manager", "member"] as const;
export const TASK_STATUSES = ["Backlog", "In Progress", "Review", "Done"] as const;
export const TASK_PRIORITIES = ["low", "med", "high"] as const;
export const ACTIVITY_ACTIONS = [
  "created",
  "moved",
  "completed",
  "reordered",
  "assigned",
  "unassigned",
  "deleted",
  "imported",
  "reset",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type AuthUser = {
  userId: string;
  role: UserRole;
  name: string;
};

export type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  avatar: string | null;
  created_at: string;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string;
  priority: TaskPriority;
  labels: string[];
  due_date: string | null;
  estimate_hours: number;
  completed_date: string | null;
  position: number;
  has_warning: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CommentRow = {
  id: string;
  task_id: string;
  user_id: string | null;
  text: string;
  created_at: string;
};

export type ActivityLogRow = {
  id: string;
  task_id: string | null;
  user_id: string | null;
  action: ActivityAction;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
};

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiFailure = {
  ok: false;
  error: string;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function canManageTasks(role: UserRole): boolean {
  return role === "admin" || role === "manager";
}
