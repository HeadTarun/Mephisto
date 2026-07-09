"use client";

export type ToastMessage = {
  id: number;
  text: string;
  tone?: "info" | "success" | "error";
};

export function Toasts({ messages }: { messages: ToastMessage[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`rounded-md px-4 py-3 text-sm font-medium shadow-lg ${
            message.tone === "error"
              ? "bg-red-600 text-white"
              : message.tone === "success"
                ? "bg-emerald-600 text-white"
                : "bg-slate-900 text-white"
          }`}
        >
          {message.text}
        </div>
      ))}
    </div>
  );
}
