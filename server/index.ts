import path from "node:path";
import http from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { BlackjackTableManager } from "./blackjack/tableManager.js";
import { createApiRouter } from "./routes.js";
import { assertServerConfig, config } from "./config.js";
import type { Realtime } from "./realtime.js";
import { createSocketServer } from "./socket.js";

assertServerConfig();

const app = express();
const server = http.createServer(app);

let tableManager!: BlackjackTableManager;

const realtime: Realtime = {
  chatMessage(message) {
    io.to("chat:general").emit("chat:message", message);
  },
  noteCreated(userId, note) {
    io.to(`user:${userId}`).emit("note:created", note);
  },
  async walletChanged(userIds, reason, detail) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const userId of [...new Set(ids)]) {
      io.to(`user:${userId}`).emit("wallet:changed", detail ? { reason, ...detail } : { reason });
    }
  },
  async adminChanged(reason) {
    io.to("admin").emit("admin:changed", { reason });
  },
  blackjackLobby() {
    io.to("blackjack:lobby").emit("blackjack:lobby", tableManager.listLobby());
  }
};

tableManager = new BlackjackTableManager(realtime);

const io = createSocketServer(server, tableManager);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", createApiRouter(realtime, tableManager));

if (config.nodeEnv === "production") {
  const clientDist = path.resolve(process.cwd(), "client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
    root: path.resolve(process.cwd(), "client")
  });
  app.use(vite.middlewares);
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`blackjack listening on http://0.0.0.0:${config.port}`);
});
