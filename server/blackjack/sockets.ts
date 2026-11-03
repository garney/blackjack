import type { Server } from "socket.io";
import { supabaseAdmin } from "../supabase.js";
import { config } from "../config.js";
import type { BlackjackTableManager } from "./tableManager.js";

export function registerBlackjackSockets(io: Server, tables: BlackjackTableManager) {
  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const displayName = (socket.data.displayName as string) || "Player";

    tables.joinLobby(socket.id, io);
    socket.emit("blackjack:lobby", tables.listLobby());
    const mine = tables.getTableForUser(userId);
    if (mine) {
      tables.watchTable(mine.id, socket.id, io);
      socket.emit("blackjack:state", mine);
    }

    socket.on("blackjack:watch", (payload, ack?: (r: unknown) => void) => {
      const tableId = payload?.tableId ? String(payload.tableId) : null;
      if (!tableId) {
        ack?.({ ok: false, error: "Missing tableId" });
        return;
      }
      tables.watchTable(tableId, socket.id, io);
      const table = tables.getPublicTable(tableId);
      if (table) socket.emit("blackjack:state", table);
      ack?.({ ok: Boolean(table), table });
    });

    socket.on("blackjack:create-table", async (payload, ack?: (r: unknown) => void) => {
      try {
        const table = await tables.createLiveTable(userId, displayName, {
          title: String(payload?.title ?? "My table"),
          minBet: Number(payload?.minBet ?? 5),
          maxBet: Number(payload?.maxBet ?? 50),
          bankroll: Number(payload?.bankroll ?? 500)
        });
        tables.watchTable(table.id, socket.id, io);
        ack?.({ ok: true, table });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:join-practice", async (_payload, ack?: (r: unknown) => void) => {
      try {
        const table = await tables.joinPractice(userId, displayName);
        tables.watchTable(table.id, socket.id, io);
        ack?.({ ok: true, table });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:join", async (payload, ack?: (r: unknown) => void) => {
      try {
        const table = tables.joinTable(userId, displayName, String(payload?.tableId));
        tables.watchTable(table.id, socket.id, io);
        ack?.({ ok: true, table });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:leave", (_payload, ack?: (r: unknown) => void) => {
      try {
        tables.leaveTable(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:leave-host", (_payload, ack?: (r: unknown) => void) => {
      try {
        tables.leaveHost(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:end-table", async (_payload, ack?: (r: unknown) => void) => {
      try {
        await tables.endTable(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:start-betting", (_payload, ack?: (r: unknown) => void) => {
      try {
        tables.startBetting(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:bet", async (payload, ack?: (r: unknown) => void) => {
      try {
        await tables.placeBet(userId, Number(payload?.amount));
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:deal", async (_payload, ack?: (r: unknown) => void) => {
      try {
        await tables.dealRound(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:hit", (_payload, ack?: (r: unknown) => void) => {
      try {
        tables.hit(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });

    socket.on("blackjack:stand", (_payload, ack?: (r: unknown) => void) => {
      try {
        tables.stand(userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Failed" });
      }
    });
  });
}

export async function enrichSocketUser(
  socket: import("socket.io").Socket,
  userId: string
) {
  const { data } = await supabaseAdmin.from("profiles").select("display_name").eq("id", userId).maybeSingle();
  socket.data.displayName = data?.display_name?.trim() || "Player";
  const { data: adminRow } = await supabaseAdmin.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle();
  socket.data.isAdmin = Boolean(adminRow) || config.adminUserIds.has(userId);
}
