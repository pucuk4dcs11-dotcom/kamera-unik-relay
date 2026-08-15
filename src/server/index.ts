import { DurableObject } from "cloudflare:workers";

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

function ambilBearer(request: Request): string {
  const auth =
    request.headers.get("Authorization") || "";

  if (!auth.startsWith("Bearer ")) {
    return "";
  }

  return auth.slice(7).trim();
}

export default {
  async fetch(
    request: Request,
    env: any,
  ): Promise<Response> {

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        relay: "Kamera Unik Relay",
        status: "online",
      });
    }

    if (url.pathname !== "/relay") {
      return new Response(
        "Not Found",
        { status: 404 },
      );
    }

    if (
      request.headers
        .get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {
      return new Response(
        "WebSocket required",
        { status: 426 },
      );
    }

    const room =
      url.searchParams.get("room")?.trim();

    const role =
      url.searchParams.get("role")?.trim();

    const sessionKey =
      ambilBearer(request);

    if (!room) {
      return new Response(
        "Room required",
        { status: 400 },
      );
    }

    if (
      role !== "cctv" &&
      role !== "control"
    ) {
      return new Response(
        "Invalid role",
        { status: 400 },
      );
    }

    if (
      !sessionKey ||
      sessionKey.length < 32
    ) {
      return new Response(
        "Unauthorized",
        { status: 401 },
      );
    }

    const id =
      env.Chat.idFromName(
        `${room}:${sessionKey}`,
      );

    const stub =
      env.Chat.get(id);

    const headers =
      new Headers(request.headers);

    headers.set(
      "X-Kamera-Unik-Role",
      role,
    );

    return stub.fetch(
      new Request(
        request,
        { headers },
      ),
    );
  },
};

export class Chat extends DurableObject {

  async fetch(
    request: Request,
  ): Promise<Response> {

    if (
      request.headers
        .get("Upgrade")
        ?.toLowerCase() !== "websocket"
    ) {
      return new Response(
        "WebSocket required",
        { status: 426 },
      );
    }

    const role =
      request.headers.get(
        "X-Kamera-Unik-Role",
      );

    if (
      role !== "cctv" &&
      role !== "control"
    ) {
      return new Response(
        "Invalid role",
        { status: 400 },
      );
    }

    const pair =
      new WebSocketPair();

    const [client, server] =
      Object.values(pair);

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      role,
      connectedAt: Date.now(),
    });

    server.send(
      JSON.stringify({
        type: "READY",
        role,
      }),
    );

    return new Response(
      null,
      {
        status: 101,
        webSocket: client,
      },
    );
  }

  async webSocketMessage(
    sender: WebSocket,
    message: string | ArrayBuffer,
  ) {

    const senderInfo =
      sender.deserializeAttachment() as
        | { role: string }
        | null;

    if (!senderInfo) return;

    const targetRole =
      senderInfo.role === "cctv"
        ? "control"
        : "cctv";

    for (
      const socket
      of this.ctx.getWebSockets()
    ) {

      if (socket === sender) continue;

      const info =
        socket.deserializeAttachment() as
          | { role: string }
          | null;

      if (
        !info ||
        info.role !== targetRole
      ) {
        continue;
      }

      try {
        socket.send(message);
      } catch (_) {
        try {
          socket.close(
            1011,
            "Relay error",
          );
        } catch (_) {}
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ) {
    try {
      ws.close(code, reason);
    } catch (_) {}
  }

  async webSocketError(
    ws: WebSocket,
  ) {
    try {
      ws.close(
        1011,
        "WebSocket error",
      );
    } catch (_) {}
  }
}
