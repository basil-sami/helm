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

// PWA: app-shell support (production only). Assets are network-first,
// so a new deploy is picked up immediately; old caches are purged on update.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      reg.update();
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "activated" && navigator.serviceWorker.controller && !sessionStorage.getItem("swReloaded")) {
            sessionStorage.setItem("swReloaded", "1");
            location.reload();
          }
        });
      });
    }).catch(() => {});
  });
}
