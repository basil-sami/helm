import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { BrandingProvider } from "./context/BrandingContext";
import { I18nProvider } from "./context/I18nContext";
import { ToastProvider } from "./components/Toast";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <BrandingProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </BrandingProvider>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  </React.StrictMode>
);

// Hard cache reset: unregister any service worker left by older deployments,
// delete every cache, and reload once so the current build always runs.
// This permanently eliminates stale-bundle issues (SW/PWA registration is
// intentionally removed — the app is network-first now).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => {
        if (!regs.length) return;
        return Promise.all(regs.map((r) => r.unregister()))
          .then(() => "caches" in window ? caches.keys() : [])
          .then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
          .then(() => {
            if (!sessionStorage.getItem("swPurged")) {
              sessionStorage.setItem("swPurged", "1");
              location.reload();
            }
          });
      })
      .catch(() => {});
  });
}
