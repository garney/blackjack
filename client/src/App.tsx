import { useEffect, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type { CreditRequest, Profile, PublicTable, RedemptionRequest } from "../../shared/types";
import { api } from "./api";
import { BlackjackTableView } from "./components/BlackjackTableView";
import { supabase } from "./supabase";

type SessionState = "loading" | "signed-out" | "signed-in";
type Tab = "lobby" | "wallet" | "admin";

function socketAck<T>(socket: Socket, event: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload ?? {}, (err: Error | null, response: T) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
}

export function App() {
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>("lobby");
  const [lobby, setLobby] = useState<PublicTable[]>([]);
  const [table, setTable] = useState<PublicTable | null>(null);
  const [socketState, setSocketState] = useState<"off" | "live">("off");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hostTitle, setHostTitle] = useState("Friday night");
  const [hostBankroll, setHostBankroll] = useState("500");
  const [hostMin, setHostMin] = useState("5");
  const [hostMax, setHostMax] = useState("50");
  const [betAmount, setBetAmount] = useState("10");
  const socketRef = useRef<Socket | null>(null);
  const profileIdRef = useRef<string | null>(null);
  const tableIdRef = useRef<string | null>(null);
  profileIdRef.current = profile?.id ?? null;
  tableIdRef.current = table?.id ?? null;

  async function watchTableById(tableId: string, options?: { switchToLobby?: boolean }) {
    const socket = socketRef.current;
    if (!socket) throw new Error("Not connected");
    if (options?.switchToLobby !== false) setTab("lobby");
    const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:watch", {
      tableId
    });
    if (!res.ok || !res.table) throw new Error(res.error ?? "Table not found");
    setTable(res.table);
  }

  async function refreshProfile() {
    const me = await api.me();
    setProfile(me);
  }

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        setProfile(null);
        setTable(null);
        setSessionState("signed-out");
        return;
      }
      try {
        await refreshProfile();
        setSessionState("signed-in");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not load profile");
        setSessionState("signed-out");
      }
    });
    void supabase.auth.getSession();
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (sessionState !== "signed-in") return;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      const socket = io({ auth: { token } });
      socketRef.current = socket;
      socket.on("connect", () => setSocketState("live"));
      socket.on("disconnect", () => setSocketState("off"));
      socket.on("blackjack:lobby", (rows: PublicTable[]) => setLobby(rows));
      socket.on("blackjack:state", (state: PublicTable) => {
        const pid = profileIdRef.current;
        const watchingId = tableIdRef.current;
        const relevant =
          state.id === watchingId ||
          state.dealerUserId === pid ||
          (pid != null && state.seats.some((s) => s.userId === pid));

        if (state.phase === "finished") {
          if (relevant) setTable(null);
          return;
        }
        if (relevant) setTable(state);
      });
      socket.on("blackjack:error", (payload: { message?: string }) => {
        if (payload?.message) setMessage(payload.message);
      });
      socket.on("wallet:changed", () => void refreshProfile().catch(() => undefined));
      socket.on("admin:changed", () => {
        if (profile?.isAdmin) void loadAdmin().catch(() => undefined);
      });
    });
    return () => {
      cancelled = true;
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocketState("off");
    };
  }, [sessionState, profile?.isAdmin]);

  const [adminSummary, setAdminSummary] = useState<Awaited<ReturnType<typeof api.adminSummary>> | null>(null);
  const [adminUsers, setAdminUsers] = useState<Awaited<ReturnType<typeof api.adminUsers>>>([]);
  const [creditQueue, setCreditQueue] = useState<CreditRequest[]>([]);
  const [redemptionQueue, setRedemptionQueue] = useState<RedemptionRequest[]>([]);
  const [walletTx, setWalletTx] = useState<Awaited<ReturnType<typeof api.walletTransactions>>>([]);

  async function loadAdmin() {
    const [summary, users, credits, redemptions] = await Promise.all([
      api.adminSummary(),
      api.adminUsers(),
      api.adminCreditRequests(),
      api.adminRedemptions()
    ]);
    setAdminSummary(summary);
    setAdminUsers(users);
    setCreditQueue(credits.filter((r) => r.status === "pending"));
    setRedemptionQueue(redemptions.filter((r) => r.status === "pending"));
  }

  async function loadWallet() {
    setWalletTx(await api.walletTransactions());
  }

  useEffect(() => {
    if (tab === "wallet") void loadWallet().catch(() => undefined);
    if (tab === "admin" && profile?.isAdmin) void loadAdmin().catch(() => undefined);
  }, [tab, profile?.isAdmin]);

  async function withBusy(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const socket = socketRef.current;
  const mySeat = table?.seats.find((s) => s.userId === profile?.id);
  const myHostedTable = lobby.find((row) => row.mode === "live" && row.dealerUserId === profile?.id);
  const showingHostedTable = Boolean(myHostedTable && table?.id === myHostedTable.id);

  if (sessionState === "loading") {
    return <div className="shell center">Loading…</div>;
  }

  if (sessionState === "signed-out") {
    return (
      <div className="shell auth">
        <h1>Blackjack</h1>
        <p>Host a table as dealer or join practice with a CPU dealer.</p>
        {message ? <p className="error">{message}</p> : null}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void withBusy(async () => {
              const { error } = await supabase.auth.signInWithPassword({ email, password });
              if (error) throw error;
            });
          }}
        >
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" required />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" required />
          <button disabled={busy} type="submit">
            Sign in
          </button>
        </form>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void withBusy(async () => {
              const { error } = await supabase.auth.signUp({ email, password });
              if (error) throw error;
              setMessage("Account created. You are signed in locally.");
            })
          }
        >
          Sign up
        </button>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <strong>Blackjack</strong>
          <span className="muted">
            {profile?.displayName}
            {table?.mode === "practice" && mySeat != null ? (
              <> · <strong className="practice-balance">{mySeat.practiceChips ?? 0} practice chips</strong></>
            ) : (
              <> · {profile?.creditsBalance ?? 0} credits</>
            )}
            {" · socket "}
            {socketState}
          </span>
        </div>
        <nav className="tabs">
          {myHostedTable && !showingHostedTable ? (
            <button
              type="button"
              className="watch-hosted"
              disabled={!socket || busy}
              onClick={() => void withBusy(() => watchTableById(myHostedTable.id))}
            >
              Watch {myHostedTable.title}
            </button>
          ) : null}
          <button type="button" className={tab === "lobby" ? "active" : ""} onClick={() => setTab("lobby")}>
            Tables
          </button>
          <button type="button" className={tab === "wallet" ? "active" : ""} onClick={() => setTab("wallet")}>
            Wallet
          </button>
          {profile?.isAdmin ? (
            <button type="button" className={tab === "admin" ? "active" : ""} onClick={() => setTab("admin")}>
              Admin
            </button>
          ) : null}
          <button type="button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </nav>
      </header>

      {message ? <p className="error banner">{message}</p> : null}

      {tab === "lobby" ? (
        <div className="grid two">
          <section className="panel">
            <h2>Lobby</h2>
            <div className="actions">
              <button
                type="button"
                disabled={!socket || busy}
                onClick={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(
                      socket,
                      "blackjack:join-practice"
                    );
                    if (!res.ok) throw new Error(res.error);
                    if (res.table) setTable(res.table);
                  })
                }
              >
                Join CPU practice
              </button>
            </div>
            <h3>Host a live table (you are the dealer)</h3>
            <p className="hint">Bankroll is taken from your wallet credits and pays player wins until you close the table.</p>
            <div className="host-form">
              <label>
                Table name
                <input value={hostTitle} onChange={(e) => setHostTitle(e.target.value)} placeholder="Friday night" />
              </label>
              <label>
                Dealer bankroll (chips)
                <input value={hostBankroll} onChange={(e) => setHostBankroll(e.target.value)} type="number" min={1} />
              </label>
              <label>
                Minimum bet per hand
                <input value={hostMin} onChange={(e) => setHostMin(e.target.value)} type="number" min={1} />
              </label>
              <label>
                Maximum bet per hand
                <input value={hostMax} onChange={(e) => setHostMax(e.target.value)} type="number" min={1} />
              </label>
              <button
                type="button"
                disabled={!socket || busy}
                onClick={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:create-table", {
                      title: hostTitle,
                      bankroll: Number(hostBankroll),
                      minBet: Number(hostMin),
                      maxBet: Number(hostMax)
                    });
                    if (!res.ok) throw new Error(res.error);
                    await refreshProfile();
                    if (res.table) setTable(res.table);
                  })
                }
              >
                Open table
              </button>
            </div>
            <ul className="table-list">
              {lobby.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.title}</strong>
                    <span className="muted">
                      {row.mode}
                      {row.mode === "live" && row.dealerBankroll != null ? ` · bankroll ${row.dealerBankroll}` : ""}
                      {" · "}
                      {row.seatedCount}/{row.maxSeats} · {row.phase}
                      {row.dealerAway ? " · host away" : ""}
                    </span>
                  </div>
                  {row.mode === "live" && row.dealerUserId === profile?.id ? (
                    <button
                      type="button"
                      disabled={!socket || busy}
                      onClick={() => void withBusy(() => watchTableById(row.id))}
                    >
                      Watch table
                    </button>
                  ) : null}
                  {row.mode === "live" && row.dealerUserId !== profile?.id ? (
                    <button
                      type="button"
                      disabled={!socket || busy || Boolean(table)}
                      onClick={() =>
                        void withBusy(async () => {
                          if (!socket) return;
                          const res = await socketAck<{ ok: boolean; error?: string; table?: PublicTable }>(socket, "blackjack:join", {
                            tableId: row.id
                          });
                          if (!res.ok) throw new Error(res.error);
                          if (res.table) setTable(res.table);
                        })
                      }
                    >
                      Join
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel table-view panel-wide">
            <h2>{table ? table.title : "No table"}</h2>
            {!table ? <p className="muted">Join practice or host a table.</p> : null}
            {table && profile ? (
              <BlackjackTableView
                table={table}
                profile={profile}
                betAmount={betAmount}
                setBetAmount={setBetAmount}
                busy={busy}
                socketReady={Boolean(socket)}
                onBet={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:bet", {
                      amount: Number(betAmount)
                    });
                    if (!res.ok) throw new Error(res.error);
                  })
                }
                onHit={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:hit");
                    if (!res.ok) throw new Error(res.error);
                  })
                }
                onStand={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:stand");
                    if (!res.ok) throw new Error(res.error);
                  })
                }
                onLeave={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:leave");
                    if (!res.ok) throw new Error(res.error);
                    if (table.dealerUserId !== profile.id) setTable(null);
                  })
                }
                onLeaveHost={() =>
                  void withBusy(async () => {
                    if (!socket || !table) return;
                    const tableId = table.id;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:leave-host");
                    if (!res.ok) throw new Error(res.error);
                    await watchTableById(tableId);
                  })
                }
                onStartBetting={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:start-betting");
                    if (!res.ok) throw new Error(res.error);
                  })
                }
                onDeal={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:deal");
                    if (!res.ok) throw new Error(res.error);
                  })
                }
                onEndTable={() =>
                  void withBusy(async () => {
                    if (!socket) return;
                    const res = await socketAck<{ ok: boolean; error?: string }>(socket, "blackjack:end-table");
                    if (!res.ok) throw new Error(res.error);
                    setTable(null);
                    await refreshProfile();
                  })
                }
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "wallet" ? (
        <section className="panel">
          <h2>Wallet</h2>
          <WalletPanel onRefresh={refreshProfile} />
          <h3>Recent transactions</h3>
          <ul>
            {walletTx.map((tx) => (
              <li key={tx.id}>
                {tx.kind} {tx.amountCredits} — {tx.description}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === "admin" && profile?.isAdmin ? (
        <section className="panel">
          <h2>Admin centre</h2>
          {adminSummary ? (
            <p>
              Users {adminSummary.totalUsers} · Credits in circulation {adminSummary.totalCredits} · Live tables{" "}
              {adminSummary.liveTables}
            </p>
          ) : null}
          <AdminPanel users={adminUsers} creditQueue={creditQueue} redemptionQueue={redemptionQueue} onDone={() => void loadAdmin()} />
        </section>
      ) : null}
    </div>
  );
}

function WalletPanel({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("Weekly float");
  const [claim, setClaim] = useState("PayPal");
  const [msg, setMsg] = useState("");

  return (
    <div className="form-row">
      <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" placeholder="Amount" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
      <button
        type="button"
        onClick={() =>
          void api
            .createCreditRequest({ amountCredits: Number(amount), requestReason: reason })
            .then(() => {
              setMsg("Credit request submitted.");
              return onRefresh();
            })
            .catch((e) => setMsg(e.message))
        }
      >
        Request credits
      </button>
      <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Redemption details" />
      <button
        type="button"
        onClick={() =>
          void api
            .createRedemption({ amountCredits: Number(amount), claimDetails: claim })
            .then(() => {
              setMsg("Redemption submitted.");
              return onRefresh();
            })
            .catch((e) => setMsg(e.message))
        }
      >
        Redeem credits
      </button>
      {msg ? <p className="muted">{msg}</p> : null}
    </div>
  );
}

function AdminPanel({
  users,
  creditQueue,
  redemptionQueue,
  onDone
}: {
  users: Awaited<ReturnType<typeof api.adminUsers>>;
  creditQueue: CreditRequest[];
  redemptionQueue: RedemptionRequest[];
  onDone: () => void;
}) {
  const [grantUser, setGrantUser] = useState("");
  const [grantAmount, setGrantAmount] = useState("50");

  return (
    <>
      <div className="form-row">
        <select value={grantUser} onChange={(e) => setGrantUser(e.target.value)}>
          <option value="">Select user</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.creditsBalance})
            </option>
          ))}
        </select>
        <input value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)} type="number" />
        <button
          type="button"
          onClick={() =>
            void api.adminAddCredits({ userId: grantUser, amountCredits: Number(grantAmount) }).then(onDone)
          }
          disabled={!grantUser}
        >
          Add credits
        </button>
      </div>
      <h3>Credit requests</h3>
      {creditQueue.map((row) => (
        <div key={row.id} className="queue-row">
          {row.userName} wants {row.amountCredits} — {row.requestReason}
          <button type="button" onClick={() => void api.reviewCreditRequest(row.id, { status: "approved" }).then(onDone)}>
            Approve
          </button>
          <button type="button" onClick={() => void api.reviewCreditRequest(row.id, { status: "rejected" }).then(onDone)}>
            Reject
          </button>
        </div>
      ))}
      <h3>Redemptions</h3>
      {redemptionQueue.map((row) => (
        <div key={row.id} className="queue-row">
          {row.userName} {row.amountCredits} — {row.claimDetails}
          <button type="button" onClick={() => void api.reviewRedemption(row.id, { status: "approved" }).then(onDone)}>
            Approve
          </button>
          <button type="button" onClick={() => void api.reviewRedemption(row.id, { status: "rejected" }).then(onDone)}>
            Reject
          </button>
        </div>
      ))}
    </>
  );
}
