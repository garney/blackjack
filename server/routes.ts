import { Router } from "express";
import { z } from "zod";
import type { ChatMessage, Note } from "../shared/types.js";
import type { BlackjackTableManager } from "./blackjack/tableManager.js";
import { requireAuth, type AuthedRequest } from "./auth.js";
import { getCreditsBalance } from "./credits.js";
import type { Realtime } from "./realtime.js";
import { supabaseAdmin } from "./supabase.js";
import { registerWalletRoutes } from "./walletRoutes.js";

const noteSchema = z.object({
  body: z.string().min(1).max(2000)
});

const chatSchema = z.object({
  body: z.string().trim().min(1).max(1000)
});

function mapNote(row: { id: string; body: string; created_at: string }): Note {
  return { id: row.id, body: row.body, createdAt: row.created_at };
}

function mapChatMessage(row: {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  profiles?: { display_name?: string | null } | { display_name?: string | null }[] | null;
}): ChatMessage {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    displayName: profile?.display_name?.trim() || "User",
    body: row.body,
    createdAt: row.created_at
  };
}

export function createApiRouter(realtime: Realtime, tableManager: BlackjackTableManager) {
  const router = Router();
  registerWalletRoutes(router, realtime, tableManager);

  /**
   * @swagger
   * /api/health:
   *   get:
   *     tags: [System]
   *     summary: Health check
   *     description: Returns ok when the process is serving HTTP.
   *     responses:
   *       200:
   *         description: Service is up
   */
  router.get("/health", (_req, res) => {
    res.json({ ok: true, app: "blackjack" });
  });

  /**
   * @swagger
   * /api/me:
   *   get:
   *     tags: [Auth]
   *     summary: Current profile
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Signed-in profile
   *       401:
   *         description: Missing or invalid token
   */
  router.get("/me", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    let creditsBalance = 0;
    try {
      creditsBalance = await getCreditsBalance(user.id);
    } catch {
      creditsBalance = 0;
    }
    res.json({
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      creditsBalance,
      isAdmin: user.isAdmin
    });
  });

  /**
   * @swagger
   * /api/notes:
   *   get:
   *     tags: [Notes]
   *     summary: List notes for the signed-in user
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Notes
   *       401:
   *         description: Missing or invalid token
   */
  router.get("/notes", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("notes")
      .select("id, body, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json((data ?? []).map(mapNote));
  });

  /**
   * @swagger
   * /api/notes:
   *   post:
   *     tags: [Notes]
   *     summary: Create a note
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [body]
   *             properties:
   *               body:
   *                 type: string
   *           example:
   *             body: Ship the local stack
   *     responses:
   *       200:
   *         description: Created note
   *       400:
   *         description: Invalid body
   *       401:
   *         description: Missing or invalid token
   */
  router.post("/notes", requireAuth, async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("notes")
      .insert({ user_id: user.id, body: parsed.data.body })
      .select("id, body, created_at")
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? "Could not create note" });
      return;
    }

    const note = mapNote(data);
    realtime.noteCreated(user.id, note);
    res.json(note);
  });

  /**
   * @swagger
   * /api/chat/messages:
   *   get:
   *     tags: [Chat]
   *     summary: List recent general chat messages
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Chat messages, oldest first
   *       401:
   *         description: Missing or invalid token
   */
  router.get("/chat/messages", requireAuth, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .select("id, user_id, body, created_at, profiles!chat_messages_user_id_fkey(display_name)")
      .order("created_at", { ascending: false })
      .limit(80);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json((data ?? []).map(mapChatMessage).reverse());
  });

  /**
   * @swagger
   * /api/chat/messages:
   *   post:
   *     tags: [Chat]
   *     summary: Send a chat message
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [body]
   *             properties:
   *               body:
   *                 type: string
   *           example:
   *             body: Socket.IO is live
   *     responses:
   *       200:
   *         description: Created message
   *       400:
   *         description: Invalid body
   *       401:
   *         description: Missing or invalid token
   */
  router.post("/chat/messages", requireAuth, async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("chat_messages")
      .insert({ user_id: user.id, body: parsed.data.body })
      .select("id, user_id, body, created_at, profiles!chat_messages_user_id_fkey(display_name)")
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message ?? "Could not send message" });
      return;
    }

    const message = {
      ...mapChatMessage(data),
      displayName: user.displayName
    };
    realtime.chatMessage(message);
    res.json(message);
  });

  return router;
}
