import { Router } from "express";
import { z } from "zod";
import type {
  AdminSummary,
  AdminUser,
  CreditRequest,
  CreditRequestStatus,
  CreditTransaction,
  RedemptionRequest,
  RedemptionStatus
} from "../shared/types.js";
import { requireAuth, requireCreditAdmin, type AuthedRequest } from "./auth.js";
import { supabaseAdmin } from "./supabase.js";
import type { Realtime } from "./realtime.js";
import type { BlackjackTableManager } from "./blackjack/tableManager.js";

const adminCreditAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  amountCredits: z.number().positive().max(10000),
  description: z.string().min(3).max(180).default("Admin credit adjustment")
});

const createRedemptionSchema = z.object({
  amountCredits: z.number().positive().max(10000),
  claimDetails: z.string().min(3).max(1000)
});

const updateRedemptionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  adminNote: z.string().max(1000).optional()
});

const createCreditRequestSchema = z.object({
  amountCredits: z.number().positive().max(10000),
  requestReason: z.string().min(3).max(1000)
});

const updateCreditRequestSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  adminNote: z.string().max(1000).optional()
});

function mapTransaction(row: {
  id: string;
  user_id: string;
  amount_credits: number;
  kind: CreditTransaction["kind"];
  description: string;
  table_id: string | null;
  created_at: string;
}): CreditTransaction {
  return {
    id: row.id,
    userId: row.user_id,
    amountCredits: Number(row.amount_credits),
    kind: row.kind,
    description: row.description,
    tableId: row.table_id,
    createdAt: row.created_at
  };
}

function profileName(profiles: { display_name?: string | null; email?: string | null } | null | undefined) {
  return profiles?.display_name?.trim() || profiles?.email || "User";
}

function mapRedemptionRequest(row: {
  id: string;
  user_id: string;
  amount_credits: number;
  status: RedemptionStatus;
  claim_details: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profiles?: { display_name?: string | null; email?: string | null } | { display_name?: string | null; email?: string | null }[] | null;
}): RedemptionRequest {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    userName: profileName(profile),
    userEmail: profile?.email ?? null,
    amountCredits: Number(row.amount_credits),
    status: row.status,
    claimDetails: row.claim_details,
    adminNote: row.admin_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

function mapCreditRequest(row: {
  id: string;
  user_id: string;
  amount_credits: number;
  status: CreditRequestStatus;
  request_reason: string;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  profiles?: { display_name?: string | null; email?: string | null } | { display_name?: string | null; email?: string | null }[] | null;
}): CreditRequest {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    userId: row.user_id,
    userName: profileName(profile),
    userEmail: profile?.email ?? null,
    amountCredits: Number(row.amount_credits),
    status: row.status,
    requestReason: row.request_reason,
    adminNote: row.admin_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at
  };
}

export function registerWalletRoutes(router: Router, realtime: Realtime, tableManager: BlackjackTableManager) {
  router.get("/wallet/transactions", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapTransaction));
  });

  router.get("/wallet/redemptions", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("redemption_requests")
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapRedemptionRequest));
  });

  router.get("/wallet/credit-requests", requireAuth, async (req, res) => {
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapCreditRequest));
  });

  router.post("/wallet/redemptions", requireAuth, async (req, res) => {
    const parsed = createRedemptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = (req as AuthedRequest).user;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .single();
    if (profileError || !profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    const amount = parsed.data.amountCredits;
    const currentBalance = Number(profile.credits_balance);
    if (currentBalance < amount) {
      res.status(402).json({ error: "Not enough credits to redeem" });
      return;
    }
    const nextBalance = currentBalance - amount;
    const { error: balanceError } = await supabaseAdmin.from("profiles").update({ credits_balance: nextBalance }).eq("id", user.id);
    if (balanceError) {
      res.status(500).json({ error: balanceError.message });
      return;
    }
    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from("redemption_requests")
      .insert({
        user_id: user.id,
        amount_credits: amount,
        claim_details: parsed.data.claimDetails
      })
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .single();
    if (redemptionError) {
      await supabaseAdmin.from("profiles").update({ credits_balance: currentBalance }).eq("id", user.id);
      res.status(500).json({ error: redemptionError.message });
      return;
    }
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: user.id,
      amount_credits: -amount,
      kind: "withdrawal",
      description: "Redemption request",
      created_by: user.id
    });
    await realtime.walletChanged(user.id, "redemption-requested", { creditsBalance: nextBalance });
    await realtime.adminChanged("redemptions");
    res.status(201).json(mapRedemptionRequest(redemption));
  });

  router.post("/wallet/credit-requests", requireAuth, async (req, res) => {
    const parsed = createCreditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const user = (req as AuthedRequest).user;
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .insert({
        user_id: user.id,
        amount_credits: parsed.data.amountCredits,
        request_reason: parsed.data.requestReason
      })
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    await realtime.adminChanged("credit-requests");
    res.status(201).json(mapCreditRequest(data));
  });

  router.get("/admin/summary", requireAuth, requireCreditAdmin, async (_req, res) => {
    const [profiles, transactions] = await Promise.all([
      supabaseAdmin.from("profiles").select("credits_balance", { count: "exact" }),
      supabaseAdmin.from("credit_transactions").select("id", { count: "exact", head: true })
    ]);
    const summary: AdminSummary = {
      totalUsers: profiles.count ?? profiles.data?.length ?? 0,
      totalCredits: (profiles.data ?? []).reduce((total, profile) => total + Number(profile.credits_balance), 0),
      totalTransactions: transactions.count ?? 0,
      liveTables: tableManager.getLiveTableCount()
    };
    res.json(summary);
  });

  router.get("/admin/users", requireAuth, requireCreditAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, email, credits_balance")
      .order("display_name", { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    const users: AdminUser[] = (data ?? []).map((profile) => ({
      id: profile.id,
      displayName: profile.display_name,
      email: profile.email,
      creditsBalance: Number(profile.credits_balance)
    }));
    res.json(users);
  });

  router.post("/admin/credits", requireAuth, requireCreditAdmin, async (req, res) => {
    const parsed = adminCreditAdjustmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const admin = (req as AuthedRequest).user;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("credits_balance")
      .eq("id", parsed.data.userId)
      .single();
    if (profileError || !profile) {
      res.status(404).json({ error: "User profile not found" });
      return;
    }
    const nextBalance = Number(profile.credits_balance) + parsed.data.amountCredits;
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ credits_balance: nextBalance })
      .eq("id", parsed.data.userId);
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }
    await supabaseAdmin.from("credit_transactions").insert({
      user_id: parsed.data.userId,
      amount_credits: parsed.data.amountCredits,
      kind: "adjustment",
      description: parsed.data.description,
      created_by: admin.id
    });
    await realtime.walletChanged(parsed.data.userId, "admin-credit-adjustment", { creditsBalance: nextBalance });
    await realtime.adminChanged("credits");
    res.status(201).json({ ok: true, creditsBalance: nextBalance });
  });

  router.get("/admin/transactions", requireAuth, requireCreditAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin.from("credit_transactions").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapTransaction));
  });

  router.get("/admin/redemptions", requireAuth, requireCreditAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("redemption_requests")
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapRedemptionRequest));
  });

  router.get("/admin/credit-requests", requireAuth, requireCreditAdmin, async (_req, res) => {
    const { data, error } = await supabaseAdmin
      .from("credit_requests")
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json((data ?? []).map(mapCreditRequest));
  });

  router.patch("/admin/redemptions/:id", requireAuth, requireCreditAdmin, async (req, res) => {
    const parsed = updateRedemptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const admin = (req as AuthedRequest).user;
    const { data: redemption, error: redemptionError } = await supabaseAdmin
      .from("redemption_requests")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (redemptionError || !redemption) {
      res.status(404).json({ error: "Redemption request not found" });
      return;
    }
    if (redemption.status !== "pending") {
      res.status(409).json({ error: "This redemption request has already been reviewed" });
      return;
    }
    if (parsed.data.status === "rejected") {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("credits_balance")
        .eq("id", redemption.user_id)
        .single();
      if (profileError || !profile) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      const refund = Number(redemption.amount_credits);
      await supabaseAdmin
        .from("profiles")
        .update({ credits_balance: Number(profile.credits_balance) + refund })
        .eq("id", redemption.user_id);
      await supabaseAdmin.from("credit_transactions").insert({
        user_id: redemption.user_id,
        amount_credits: refund,
        kind: "adjustment",
        description: "Rejected redemption refund",
        created_by: admin.id
      });
    }
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("redemption_requests")
      .update({
        status: parsed.data.status,
        admin_note: parsed.data.adminNote ?? null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", redemption.id)
      .select("*, profiles!redemption_requests_user_id_fkey(display_name, email)")
      .single();
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }
    if (parsed.data.status === "rejected") {
      await realtime.walletChanged(redemption.user_id, "redemption-refunded");
    }
    await realtime.adminChanged("redemptions");
    res.json(mapRedemptionRequest(updated));
  });

  router.patch("/admin/credit-requests/:id", requireAuth, requireCreditAdmin, async (req, res) => {
    const parsed = updateCreditRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const admin = (req as AuthedRequest).user;
    const { data: creditRequest, error: requestError } = await supabaseAdmin
      .from("credit_requests")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (requestError || !creditRequest) {
      res.status(404).json({ error: "Credit request not found" });
      return;
    }
    if (creditRequest.status !== "pending") {
      res.status(409).json({ error: "This credit request has already been reviewed" });
      return;
    }
    if (parsed.data.status === "approved") {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("credits_balance")
        .eq("id", creditRequest.user_id)
        .single();
      if (profileError || !profile) {
        res.status(404).json({ error: "User profile not found" });
        return;
      }
      const amount = Number(creditRequest.amount_credits);
      await supabaseAdmin
        .from("profiles")
        .update({ credits_balance: Number(profile.credits_balance) + amount })
        .eq("id", creditRequest.user_id);
      await supabaseAdmin.from("credit_transactions").insert({
        user_id: creditRequest.user_id,
        amount_credits: amount,
        kind: "adjustment",
        description: "Approved credit request",
        created_by: admin.id
      });
    }
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("credit_requests")
      .update({
        status: parsed.data.status,
        admin_note: parsed.data.adminNote ?? null,
        reviewed_by: admin.id,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", creditRequest.id)
      .select("*, profiles!credit_requests_user_id_fkey(display_name, email)")
      .single();
    if (updateError) {
      res.status(500).json({ error: updateError.message });
      return;
    }
    if (parsed.data.status === "approved") {
      await realtime.walletChanged(creditRequest.user_id, "credit-request-approved");
    }
    await realtime.adminChanged("credit-requests");
    res.json(mapCreditRequest(updated));
  });
}
