import type { ChatMessage, Note } from "../shared/types.js";

export type Realtime = {
  chatMessage: (message: ChatMessage) => void;
  noteCreated: (userId: string, note: Note) => void;
  walletChanged: (
    userIds: string | string[],
    reason: string,
    detail?: { creditsBalance: number }
  ) => Promise<void>;
  adminChanged: (reason: string) => Promise<void>;
  blackjackLobby: () => void;
};
