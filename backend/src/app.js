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
import { dashboardRouter, settingsRouter, mailRouter, integrationRunsRouter } from "./routes/aggregate.js";
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
import { dailyPulseCronHandler } from "./dailypulse.js";
import { metricsRouter, targetsExtraRouter, targetsRouter, alertsRouter, dashboardsEnsure, dashboardsRouter, reportsRouter, analyticsOverviewRouter } from "./routes/metrics.js";
import { variantsRouter, scheduledRouter, scheduledExtraRouter, bioPagesRouter, bioLinksRouter, publicBioRouter } from "./routes/publish.js";
import { workflowsRouter, workflowsExtraRouter, scoreRulesRouter, scoreRulesExtraRouter, waTemplatesRouter, waTemplatesExtraRouter } from "./routes/workflows.js";
import { mediaPlansRouter, placementsRouter, promotionsRouter, promotionsExtraRouter, referralsRouter, partnersRouter, partnerCampaignsRouter, playbooksRouter, adSpendRouter, inboxRouter, inboxExtraRouter, keyResultsRouter } from "./routes/connect.js";
import { sitesRouter, pulseJsRouter, collectRouter } from "./webtrack.js";
import { digestRouter } from "./digest.js";
import { hooksRouter } from "./routes/hooks.js";
import { filesRouter, storageInfoRouter } from "./routes/files.js";
import { systemRouter, clientErrorRouter } from "./routes/system.js";
import { aiRouter } from "./routes/ai.js";
import { forecastRouter } from "./routes/forecast.js";
import { mmmRouter } from "./routes/mmm.js";
import { departmentsRouter } from "./routes/departments.js";
import { searchRouter } from "./routes/search.js";
import { recordError, digestOf, newRequestId, healthReport } from "./observability.js";
import { publishTickCronHandler } from "./publishtick.js";
import { outreachRouter, outreachExtraRouter, touchesRouter, coverageRouter, competitorsRouter } from "./routes/reach.js";
import { securityHeaders } from "./security.js";
import { setupRouter } from "./routes/setup.js";
import { approvalsRouter } from "./approvals.js";
import { creativeRequestsRouter, creativeBriefsRouter, copyBankRouter, brandAssetsRouter, assetVersionsRouter, brandPublicRouter } from "./routes/studio.js";
import { vendorsRouter, vendorScorecardRouter, engagementsRouter, deliverablesRouter, deliverableCommentsRouter, invoicesRouter, portalTokensRouter } from "./routes/agency.js";
import { portalRouter } from "./routes/portal.js";
import { contactsRouter, contactsConsentRouter } from "./routes/contacts.js";
import { formsRouter, formsExtraRouter, landingPagesRouter, publicFormsRouter, publicPagesRouter } from "./routes/automate.js";
import { surveysRouter, surveysExtraRouter, insightsRouter, publicSurveysRouter } from "./routes/research.js";
import { requireModule } from "./flags.js";
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
  // Files take a raw body, so this route mounts ahead of the JSON parser.
  app.use("/api/files", filesRouter);
  app.use((req, res, next) => {
    req.requestId = newRequestId();
    res.set("X-Request-Id", req.requestId);
    next();
  });
  app.use(express.json({ limit: "1mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, service: "Pulse API", db: process.env.DATABASE_URL ? "configured" : "missing", time: new Date().toISOString() })
  );
  app.use("/api/setup", setupRouter);          // public installer: status + first-admin bootstrap
  app.get("/api/cron/daily-pulse", dailyPulseCronHandler); // nightly heartbeat (CRON_SECRET-guarded)
  app.get("/api/cron/osint", dailyPulseCronHandler);       // legacy path — same orchestrator
  app.get("/api/cron/publish-tick", publishTickCronHandler); // auto-publish heartbeat (CRON_SECRET-guarded)
  app.get("/r/:code", redirectHandler);          // public tracked-link redirect
  app.use("/api/capture", captureRouter);       // public lead + feedback capture (rate-limited, honeypot)
  app.use("/api/auth", authRouter);
  app.use("/api/campaigns", campaignsRouter);
  app.use("/api/content", contentRouter);
  app.use("/api/leads", leadsRouter);
  app.use("/api/events", requireModule("events"), eventsRouter);
  app.use("/api/budget", budgetRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/social", requireModule("social"), socialRouter);
  app.use("/api/osint", requireModule("intel"), osintRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/planning", requireModule("planning"), planningRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/listening", requireModule("listening"), listeningRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/leads", leadActivitiesRouter);   // /:id/activities + /:id/notes (before CRUD is fine — distinct paths)
  app.use("/api/tasks", tasksBatchRouter);       // POST /batch (atomic process creation)
  app.use("/api/auth", authxRouter);             // change-password, 2FA, logout-all
  app.use("/api/links", linksRouter);
  app.use("/api/briefs", briefsRouter);
  app.use("/api/events", requireModule("events"), eventRegsRouter);       // /:id/registrations
  app.use("/api/registrations", requireModule("events"), regsRouter);     // /:id/checkin
  app.use("/api/customers", customersExtraRouter); // /convert/:leadId (before CRUD)
  app.use("/api/customers", customersRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/segments", segmentsRouter);
  app.use("/api/personas", personasRouter);
  app.use("/api/media-contacts", requireModule("media"), mediaContactsRouter);
  app.use("/api/press", requireModule("media"), pressRouter);
  app.use("/api/influencers", requireModule("media"), influencersRouter);
  app.use("/api/collabs", requireModule("media"), collabsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/assets", assetsRouter);
  app.use("/api/templates", templatesRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/brain", requireModule("brain"), brainRouter);
  // ── Wave 1·A — approvals engine + Studio + Agency ──
  app.use("/api/approvals", approvalsRouter);
  app.use("/api/creative-requests", requireModule("studio"), creativeRequestsRouter);
  app.use("/api/creative-briefs", requireModule("studio"), creativeBriefsRouter);
  app.use("/api/copy-bank", requireModule("studio"), copyBankRouter);
  app.use("/api/brand-assets", requireModule("studio"), brandAssetsRouter);
  app.use("/api/asset-versions", requireModule("studio"), assetVersionsRouter);
  app.use("/api/brand", requireModule("studio"), brandPublicRouter);        // public Brand Center
  app.use("/api/vendors", requireModule("agency"), vendorScorecardRouter);  // /:id/scorecard (before CRUD)
  app.use("/api/vendors", requireModule("agency"), vendorsRouter);
  app.use("/api/engagements", requireModule("agency"), engagementsRouter);
  app.use("/api/deliverables", requireModule("agency"), deliverableCommentsRouter); // /:id/comments (before CRUD)
  app.use("/api/deliverables", requireModule("agency"), deliverablesRouter);
  app.use("/api/invoices", requireModule("agency"), invoicesRouter);
  app.use("/api/agency/tokens", requireModule("agency"), portalTokensRouter);
  app.use("/api/portal", requireModule("agency"), portalRouter);            // public magic-link surface
  // ── Wave 1·B — forms + landing pages + surveys + contacts/consent ──
  app.use("/api/contacts", contactsConsentRouter);                          // /:id/consent (before CRUD)
  app.use("/api/contacts", contactsRouter);                                 // core: the audience layer
  app.use("/api/forms", requireModule("automate"), formsExtraRouter);       // /:id/{submissions,stats}
  app.use("/api/forms", requireModule("automate"), formsRouter);
  app.use("/api/landing-pages", requireModule("automate"), landingPagesRouter);
  app.use("/api/public/forms", requireModule("automate"), publicFormsRouter);     // /f/:slug data + submit
  app.use("/api/public/pages", requireModule("automate"), publicPagesRouter);     // /l/:slug data
  app.use("/api/surveys", requireModule("research"), surveysExtraRouter);   // /:id/{stats,responses}
  app.use("/api/surveys", requireModule("research"), surveysRouter);
  app.use("/api/insights", requireModule("research"), insightsRouter);
  app.use("/api/public/surveys", requireModule("research"), publicSurveysRouter); // /s/:slug data + submit
  // ── Wave 1·C — Analytics Core (the measurement brain; core, no flag) ──
  app.use("/api/metrics", metricsRouter);
  app.use("/api/metric-targets", targetsExtraRouter);   // /pacing (before CRUD)
  app.use("/api/metric-targets", targetsRouter);
  app.use("/api/metric-alerts", alertsRouter);
  app.use("/api/dashboards", dashboardsEnsure, dashboardsRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/analytics", analyticsOverviewRouter);   // /overview (before the legacy analytics router)
  // ── Wave 1·D — Publish: composer, queue, bio pages ──
  app.use("/api/content-variants", requireModule("publish"), variantsRouter);
  app.use("/api/scheduled-posts", requireModule("publish"), scheduledExtraRouter);
  app.use("/api/scheduled-posts", requireModule("publish"), scheduledRouter);
  app.use("/api/bio-pages", requireModule("publish"), bioPagesRouter);
  app.use("/api/bio-links", requireModule("publish"), bioLinksRouter);
  app.use("/api/public/bio", requireModule("publish"), publicBioRouter); // /b/:slug data
  // ── Wave 1·E — Automate: workflows, scoring, WA templates ──
  app.use("/api/workflows", requireModule("automate"), workflowsExtraRouter);
  app.use("/api/workflows", requireModule("automate"), workflowsRouter);
  app.use("/api/lead-score-rules", requireModule("automate"), scoreRulesExtraRouter);
  app.use("/api/lead-score-rules", requireModule("automate"), scoreRulesRouter);
  app.use("/api/wa-templates", requireModule("automate"), waTemplatesExtraRouter);
  app.use("/api/wa-templates", requireModule("automate"), waTemplatesRouter);
  // ── Wave 1·F — Reach: outreach, coverage, competitors ──
  app.use("/api/outreach", requireModule("reach"), outreachExtraRouter);
  app.use("/api/outreach", requireModule("reach"), outreachRouter);
  app.use("/api/outreach-touches", requireModule("reach"), touchesRouter);
  app.use("/api/coverage-reports", requireModule("reach"), coverageRouter);
  app.use("/api/competitors", requireModule("reach"), competitorsRouter);
  // ── Wave 1·G — Connective Tissue ──
  app.use("/api/media-plans", requireModule("media"), placementsRouter);
  app.use("/api/media-plans", requireModule("media"), mediaPlansRouter);
  app.use("/api/promotions", requireModule("planning"), promotionsExtraRouter);
  app.use("/api/promotions", requireModule("planning"), promotionsRouter);
  app.use("/api/referrals", requireModule("planning"), referralsRouter);
  app.use("/api/partners", requireModule("planning"), partnerCampaignsRouter);
  app.use("/api/partners", requireModule("planning"), partnersRouter);
  app.use("/api/playbooks", requireModule("brain"), playbooksRouter);
  app.use("/api/ad-spend", requireModule("planning"), adSpendRouter);
  app.use("/api/inbox", requireModule("social"), inboxExtraRouter);
  app.use("/api/inbox", requireModule("social"), inboxRouter);
  app.use("/api/key-results", requireModule("planning"), keyResultsRouter);
  app.use("/api/sites", requireModule("intel"), sitesRouter);
  app.use("/api/digest", digestRouter);
  app.use("/api/public/collect", requireModule("intel"), collectRouter);
  app.use("/api/public/hooks", requireModule("social"), hooksRouter);
  app.use("/api/public/pulse.js", pulseJsRouter);
  app.use("/pulse.js", pulseJsRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/storage", storageInfoRouter);
  app.get("/api/health", async (_req, res) => {
    const h = await healthReport();
    res.status(h.ok ? 200 : 503).json(h);
  });
  app.use("/api/public/client-error", clientErrorRouter);   // browser fault beacon
  app.use("/api/system", systemRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/forecast", requireModule("analytics"), forecastRouter);
  app.use("/api/mmm", requireModule("analytics"), mmmRouter);
  app.use("/api/departments", departmentsRouter);
  app.use("/api/search", requireModule("intel"), searchRouter);
  app.use("/api/mail", mailRouter);
  app.use("/api/integration-runs", integrationRunsRouter);

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

  // JSON error handler. Records the fault, then answers with a reference the
  // user can quote — "it broke this morning" becomes an id we can look up.
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    console.error(err);
    recordError({
      level: "ERROR",
      route: req.route?.path || req.originalUrl?.split("?")[0],
      method: req.method,
      status,
      message: err.message,
      stack: err.stack,
      userId: req.user?.id || null,
      requestId: req.requestId,
      userAgent: req.headers["user-agent"],
      payloadDigest: digestOf(req.body),
    });
    res.status(status).json({ error: "Server error", detail: err.message, requestId: req.requestId });
  });

  return app;
}
