import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import tasks from "../src/data/tasks.json";
import { cleanTasks } from "../src/lib/clean";
import type { TaskRow, UserRow } from "../src/lib/types";

loadEnv(".env.local");
loadEnv(".env");

const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function main() {
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("*")
    .order("created_at");

  if (usersError) {
    throw usersError;
  }

  const seededUsers = (users ?? []) as UserRow[];
  if (seededUsers.length === 0) {
    throw new Error("No users found. Run supabase/schema.sql first.");
  }

  const cleanResult = cleanTasks(tasks);
  const creator = seededUsers.find((user) => user.role === "manager") ?? seededUsers[0];
  const cleanedTasks = cleanResult.cleaned.map((task) => ({
    ...task,
    created_by: creator.id,
  }));

  await clearTable("comments", "id", "00000000-0000-0000-0000-000000000000");
  await clearTable("activity_log", "id", "00000000-0000-0000-0000-000000000000");
  await clearTable("tasks", "id", "");

  const { error: tasksError } = await supabase.from("tasks").insert(cleanedTasks);
  if (tasksError) {
    throw tasksError;
  }

  await insertMockComments(cleanedTasks, seededUsers);
  await insertMockActivity(cleanedTasks, seededUsers);

  const { count: taskCount, error: taskCountError } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true });
  if (taskCountError) {
    throw taskCountError;
  }

  const { count: commentCount, error: commentCountError } = await supabase
    .from("comments")
    .select("id", { count: "exact", head: true });
  if (commentCountError) {
    throw commentCountError;
  }

  const { count: activityCount, error: activityCountError } = await supabase
    .from("activity_log")
    .select("id", { count: "exact", head: true });
  if (activityCountError) {
    throw activityCountError;
  }

  console.log("Mock data inserted.");
  console.log(`${cleanResult.issuesFixed} issues fixed · ${cleanResult.tasksLoaded} tasks loaded`);
  console.log(`tasks=${taskCount ?? 0}, comments=${commentCount ?? 0}, activity=${activityCount ?? 0}`);
}

async function insertMockComments(
  cleanedTasks: Array<Omit<TaskRow, "created_at" | "updated_at">>,
  users: UserRow[],
) {
  const sampleTasks = cleanedTasks.slice(0, 12);
  const comments = sampleTasks.flatMap((task, index) => {
    const firstUser = users[index % users.length];
    const secondUser = users[(index + 1) % users.length];

    return [
      {
        task_id: task.id,
        user_id: firstUser.id,
        text: `Reviewed the scope for ${task.id}; this is ready for the next sprint conversation.`,
      },
      {
        task_id: task.id,
        user_id: secondUser.id,
        text: `Added a note on dependencies and expected handoff for ${task.title}.`,
      },
    ];
  });

  const { error } = await supabase.from("comments").insert(comments);
  if (error) {
    throw error;
  }
}

async function insertMockActivity(
  cleanedTasks: Array<Omit<TaskRow, "created_at" | "updated_at">>,
  users: UserRow[],
) {
  const manager = users.find((user) => user.role === "manager") ?? users[0];
  const admin = users.find((user) => user.role === "admin") ?? manager;
  const activity = [
    {
      task_id: null,
      user_id: admin.id,
      action: "imported",
      from_status: null,
      to_status: String(cleanedTasks.length),
    },
    ...cleanedTasks.slice(0, 16).map((task, index) => ({
      task_id: task.id,
      user_id: index % 2 === 0 ? manager.id : admin.id,
      action: task.status === "Done" ? "completed" : "moved",
      from_status: index % 3 === 0 ? "Backlog" : null,
      to_status: task.status,
    })),
  ];

  const { error } = await supabase.from("activity_log").insert(activity);
  if (error) {
    throw error;
  }
}

async function clearTable(table: string, column: string, value: string) {
  const { error } = await supabase.from(table).delete().neq(column, value);
  if (error) {
    throw error;
  }
}

function loadEnv(path: string) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Paste your Supabase values into .env first.`);
  }

  return value;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
