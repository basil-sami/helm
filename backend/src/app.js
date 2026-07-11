import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { authRouter } from "./auth.js";
import {
  campaignsRouter, contentRouter, leadsRouter,
  eventsRouter, budgetRouter, tasksRouter,
} from "./routes/modules.js";
import { dashboardRouter, settingsRouter } from "./routes/aggregate.js";
import { usersRouter } from "./routes/users.js";
import { socialRouter } from "./routes/social.js";
import { osintRouter } from "./routes/osint.js";
import { analyticsRouter } from "./routes/analytics.js";
import { planningRouter } from "./routes/planning.js";
import { rolesRouter } from "./routes/roles.js";
import { listeningRouter } from "./routes/listening.js";
import { brainRouter } from "./routes/brain.js";
import { exportRouter } from "./routes/export.js";
import { auditRouter } from "./routes/audit.js";
import { osintCronHandler } from "./routes/osint.js";
import { securityHeaders } from "./security.js";
import { captureRouter } from "./routes/capture.js";
import { notificationsRouter } from "./routes/notifications.js";
import { leadActivitiesRouter } from "./routes/leadActivities.js";
import { tasksBatchRouter } from "./routes/tasksBatch.js";
import { authxRouter } from "./routes/authx.js";
import { linksRouter, redirectHandler } from "./routes/links.js";
import { briefsRouter } from "./routes/briefs.js";
import { eventRegsRouter, regsRouter } from "./routes/registrations.js";
import { customersExtraRouter } from "./routes/customersExtra.js";
import { templatesRouter } from "./routes/templates.js";
import { feedbackRouter } from "./routes/feedback.js";
import { productsRouter, segmentsRouter, personasRouter, mediaContactsRouter, pressRouter,
         influencersRouter, collabsRouter, postsRouter, assetsRouter, customersRouter } from "./routes/modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(securityHeaders);
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: allowed.length ? allowed : false })); // same-origin unless explicitly allowed
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "HELM API", db: process.env.DATABASE_URL ? "configured" : "missing", time: new Date().toISOString() })
  );
  app.get("/api/cron/osint", osintCronHandler); // scheduled ingestion (CRON_SECRET-guarded)
  app.get("/r/:code", redirectHandler);          // public tracked-link redirect
  app.use("/api/capture", captureRouter);       // public lead + feedback capture (rate-limited, honeypot)
  app.use("/api/auth", authRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/content", contentRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/budget", budgetRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/osint", osintRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/planning", planningRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/listening", listeningRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/leads", leadActivitiesRouter);   // /:id/activities + /:id/notes (before CRUD is fine — distinct paths)
  app.use("/api/tasks", tasksBatchRouter);       // POST /batch (atomic process creation)
  app.use("/api/auth", authxRouter);             // change-password, 2FA, logout-all
  app.use("/api/links", linksRouter);
  app.use("/api/briefs", briefsRouter);
  app.use("/api/events", eventRegsRouter);       // /:id/registrations
  app.use("/api/registrations", regsRouter);     // /:id/checkin
  app.use("/api/customers", customersExtraRouter); // /convert/:leadId (before CRUD)
  app.use("/api/customers", customersRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/segments", segmentsRouter);
  app.use("/api/personas", personasRouter);
  app.use("/api/media-contacts", mediaContactsRouter);
  app.use("/api/press", pressRouter);
  app.use("/api/influencers", influencersRouter);
  app.use("/api/collabs", collabsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/brain", brainRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/settings", settingsRouter);

  // Local production convenience: serve the built frontend if present.
  // (On Vercel, the frontend is served as static files by the platform.)
  const clientDir = path.resolve(__dirname, "../../frontend/dist");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  // JSON error handler.
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Server error", detail: err.message });
  });

  return app;
}
