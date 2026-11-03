import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { supabaseAuth } from "./supabase.js";
import type { BlackjackTableManager } from "./blackjack/tableManager.js";
import { enrichSocketUser, registerBlackjackSockets } from "./blackjack/sockets.js";

export function createSocketServer(httpServer: HttpServer, tables: BlackjackTableManager) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      next(new Error("Missing auth token"));
      return;
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data.user) {
      next(new Error("Invalid auth token"));
      return;
    }

    socket.data.userId = data.user.id;
    await enrichSocketUser(socket, data.user.id);
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId}`);
    if (socket.data.isAdmin) socket.join("admin");
    socket.emit("hello", { userId: socket.data.userId, isAdmin: socket.data.isAdmin });
  });

  tables.attachIo(io);
  registerBlackjackSockets(io, tables);

  return io;
}
