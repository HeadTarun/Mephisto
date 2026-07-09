"use client";

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

export function useLive(onChange: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const browser = getSupabaseBrowser();
    const interval = window.setInterval(onChange, 5000);

    if (browser) {
      const channel = browser
        .channel(`sprintly-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, onChange)
        .on("postgres_changes", { event: "*", schema: "public", table: "activity_log" }, onChange)
        .subscribe();

      return () => {
        window.clearInterval(interval);
        void browser.removeChannel(channel);
      };
    }

    return () => window.clearInterval(interval);
  }, [enabled, onChange]);
}
