import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { AuthProvider } from "./auth";
import { App } from "./App";
import "./index.css";

// Native-only setup: mark the document so CSS can add safe-area insets, and let
// the status bar overlay the WebView (the header reserves space for it via the
// safe-area padding). No-ops on the web.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("native");
  void import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {}); // dark icons on the light header
  }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
