import type {
  AdminSummary,
  AdminUser,
  CreditRequest,
  CreditRequestStatus,
  CreditTransaction,
  Profile,
  PublicTable,
  RedemptionRequest,
  RedemptionStatus
} from "../../shared/types";
import { supabase } from "./supabase";

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === "string" ? body.error : `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  me: () => apiFetch<Profile>("/me"),
  walletTransactions: () => apiFetch<CreditTransaction[]>("/wallet/transactions"),
  creditRequests: () => apiFetch<CreditRequest[]>("/wallet/credit-requests"),
  createCreditRequest: (payload: { amountCredits: number; requestReason: string }) =>
    apiFetch<CreditRequest>("/wallet/credit-requests", { method: "POST", body: JSON.stringify(payload) }),
  redemptions: () => apiFetch<RedemptionRequest[]>("/wallet/redemptions"),
  createRedemption: (payload: { amountCredits: number; claimDetails: string }) =>
    apiFetch<RedemptionRequest>("/wallet/redemptions", { method: "POST", body: JSON.stringify(payload) }),
  adminSummary: () => apiFetch<AdminSummary>("/admin/summary"),
  adminUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  adminTransactions: () => apiFetch<CreditTransaction[]>("/admin/transactions"),
  adminCreditRequests: () => apiFetch<CreditRequest[]>("/admin/credit-requests"),
  adminRedemptions: () => apiFetch<RedemptionRequest[]>("/admin/redemptions"),
  adminAddCredits: (payload: { userId: string; amountCredits: number; description?: string }) =>
    apiFetch<{ ok: true; creditsBalance: number }>("/admin/credits", { method: "POST", body: JSON.stringify(payload) }),
  reviewCreditRequest: (id: string, payload: { status: CreditRequestStatus; adminNote?: string }) =>
    apiFetch<CreditRequest>(`/admin/credit-requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  reviewRedemption: (id: string, payload: { status: RedemptionStatus; adminNote?: string }) =>
    apiFetch<RedemptionRequest>(`/admin/redemptions/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
};

export type { PublicTable };
