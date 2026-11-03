import type { Realtime } from "./realtime.js";
import { supabaseAdmin } from "./supabase.js";

export type CreditKind = "deposit" | "withdrawal" | "adjustment" | "buy_in" | "payout" | "fee";

export async function adjustCredits(
  userId: string,
  delta: number,
  kind: CreditKind,
  description: string,
  options?: { tableId?: string; createdBy?: string; realtime?: Realtime; walletReason?: string }
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("adjust_credits", {
    p_user_id: userId,
    p_delta: delta
  });

  if (error) {
    throw new Error(error.message.includes("Not enough credits") ? "Not enough credits" : error.message);
  }

  const balance = Number(data);
  const { error: txError } = await supabaseAdmin.from("credit_transactions").insert({
    user_id: userId,
    amount_credits: delta,
    kind,
    description,
    table_id: options?.tableId ?? null,
    created_by: options?.createdBy ?? null
  });

  if (txError) {
    throw new Error(txError.message);
  }

  if (options?.realtime) {
    await options.realtime.walletChanged(userId, options.walletReason ?? kind, { creditsBalance: balance });
  }

  return balance;
}

export async function getCreditsBalance(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from("profiles").select("credits_balance").eq("id", userId).single();
  if (error || !data) throw new Error("Profile not found");
  return Number(data.credits_balance);
}
