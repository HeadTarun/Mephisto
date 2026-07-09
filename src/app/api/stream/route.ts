import { subscribeToChanges } from "@/lib/events";
import { requireUser } from "@/lib/auth";
import { guard } from "@/lib/response";

export async function GET() {
  return guard(async () => {
    await requireUser();
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${Date.now()}\n\n`));
        };
        const unsubscribe = subscribeToChanges(send);
        send("ready");

        return () => unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
