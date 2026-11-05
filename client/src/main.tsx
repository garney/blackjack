import React from "react";
import ReactDOM from "react-dom/client";
import { preloadCardAssets } from "./assets/cardAssets";
import { App } from "./App";
import "./styles.css";
import "./blackjack.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root");
}

rootEl.innerHTML = `<div class="app-preload" role="status">Loading table…</div>`;

try {
  await preloadCardAssets();
} catch (error) {
  console.warn("Card asset preload failed, continuing anyway.", error);
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
