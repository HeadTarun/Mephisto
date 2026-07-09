"use client";

import { useEffect, useState } from "react";

export type ToastMessage = {
  id: number;
  text: string;
  tone?: "info" | "success" | "error";
};

const ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
};

const TONE_STYLES: Record<string, string> = {
  success:
    "bg-emerald-600/95 text-white backdrop-blur-md border border-emerald-500/30",
  error:
    "bg-red-600/95 text-white backdrop-blur-md border border-red-500/30",
  info:
    "bg-slate-800/95 text-white backdrop-blur-md border border-slate-700/30",
};

const PROGRESS_COLORS: Record<string, string> = {
  success: "bg-emerald-300",
  error: "bg-red-300",
  info: "bg-slate-400",
};

function ToastItem({ message }: { message: ToastMessage }) {
  const [exiting, setExiting] = useState(false);
  const tone = message.tone ?? "info";

  useEffect(() => {
    const exitTimer = window.setTimeout(() => setExiting(true), 3100);
    return () => window.clearTimeout(exitTimer);
  }, []);

  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-xl px-4 py-3 shadow-2xl ${TONE_STYLES[tone]} overflow-hidden`}
      style={{
        minWidth: 260,
        animation: exiting
          ? "slideOutRight 350ms cubic-bezier(0.22,1,0.36,1) forwards"
          : "slideInRight 350ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {/* Icon */}
      <span
        className="grid h-6 w-6 flex-none place-items-center rounded-full text-sm font-bold"
        style={{
          background:
            tone === "success"
              ? "rgba(255,255,255,0.2)"
              : tone === "error"
                ? "rgba(255,255,255,0.2)"
                : "rgba(255,255,255,0.15)",
        }}
      >
        {ICONS[tone]}
      </span>

      {/* Text */}
      <span className="text-sm font-medium leading-snug">{message.text}</span>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-[3px] w-full">
        <div
          className={`h-full ${PROGRESS_COLORS[tone]}`}
          style={{
            animation: "progressShrink 3500ms linear forwards",
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}

export function Toasts({ messages }: { messages: ToastMessage[] }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2.5">
      {messages.map((message) => (
        <ToastItem key={message.id} message={message} />
      ))}
    </div>
  );
}
