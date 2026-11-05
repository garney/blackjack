export type Profile = {
  id: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  creditsBalance: number;
  isAdmin: boolean;
};

export type Note = {
  id: string;
  body: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
};

export type CreditTransaction = {
  id: string;
  userId: string;
  amountCredits: number;
  kind: "deposit" | "withdrawal" | "adjustment" | "buy_in" | "payout" | "fee";
  description: string;
  tableId: string | null;
  createdAt: string;
};

export type RedemptionStatus = "pending" | "approved" | "rejected";
export type CreditRequestStatus = "pending" | "approved" | "rejected";

export type RedemptionRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  amountCredits: number;
  status: RedemptionStatus;
  claimDetails: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type CreditRequest = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  amountCredits: number;
  status: CreditRequestStatus;
  requestReason: string;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type AdminSummary = {
  totalUsers: number;
  totalCredits: number;
  totalTransactions: number;
  liveTables: number;
};

export type AdminUser = {
  id: string;
  displayName: string;
  email: string | null;
  creditsBalance: number;
};

export type PublicTable = {
  id: string;
  mode: "live" | "practice";
  title: string;
  dealerUserId: string | null;
  dealerName: string;
  dealerAway: boolean;
  dealerBankroll: number | null;
  minBet: number;
  maxBet: number;
  maxSeats: number;
  seatedCount: number;
  phase: "open" | "betting" | "playing" | "dealer" | "finished";
  round: number;
  seats: Array<{
    userId: string;
    displayName: string;
    seatIndex: number;
    bet: number;
    hand: Array<{ suit: string; rank: number; label: string }>;
    handTotal: number | null;
    status: string;
    practiceChips: number | null;
    idleEndsAt: number | null;
  }>;
  dealerHand: Array<{ suit: string; rank: number; label: string }>;
  dealerTotal: number | null;
  activeSeatIndex: number | null;
  turnEndsAt: number | null;
  dealStartsAt: number | null;
  lastRoundResults: Array<{
    userId: string;
    outcome: "win" | "lose" | "push" | "blackjack" | "bust";
    bet: number;
    payout: number;
    net: number;
  }>;
};
