import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useAuth } from "./context/AuthContext";
import { useI18n } from "./context/I18nContext";
import { useBranding } from "./context/BrandingContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Onboarding from "./pages/Onboarding";
import Portal from "./pages/Portal";
import BrandCenter from "./pages/BrandCenter";
import FormPublic from "./pages/FormPublic";
import LandingPublic from "./pages/LandingPublic";
import SurveyPublic from "./pages/SurveyPublic";
import BioPublic from "./pages/BioPublic";
import PrivacyConfirm from "./pages/PrivacyConfirm";
import SecurityModal from "./components/SecurityModal";
import { EcgLoader } from "./components/PulseMark";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Planning = lazy(() => import("./pages/Planning"));
const Listening = lazy(() => import("./pages/Listening"));
const Brain = lazy(() => import("./pages/Brain"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignRoom = lazy(() => import("./pages/CampaignRoom"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Operations = lazy(() => import("./pages/Operations"));
const Leads = lazy(() => import("./pages/Leads"));
const Events = lazy(() => import("./pages/Events"));
const Budget = lazy(() => import("./pages/Budget"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Social = lazy(() => import("./pages/Social"));
const Intel = lazy(() => import("./pages/Intel"));
const Users = lazy(() => import("./pages/Users"));
const Settings = lazy(() => import("./pages/Settings"));
const Products = lazy(() => import("./pages/Products"));
const Audience = lazy(() => import("./pages/Audience"));
const Links = lazy(() => import("./pages/Links"));
const Customers = lazy(() => import("./pages/Customers"));
const Media = lazy(() => import("./pages/Media"));
const Report = lazy(() => import("./pages/Report"));
const Studio = lazy(() => import("./pages/Studio"));
const Agency = lazy(() => import("./pages/Agency"));
const Approvals = lazy(() => import("./pages/Approvals"));
const Contacts = lazy(() => import("./pages/Contacts"));
const Forms = lazy(() => import("./pages/Forms"));
const Pages = lazy(() => import("./pages/Pages"));
const Surveys = lazy(() => import("./pages/Surveys"));
const Publish = lazy(() => import("./pages/Publish"));
const Automate = lazy(() => import("./pages/Automate"));
const Reach = lazy(() => import("./pages/Reach"));
const Morning = lazy(() => import("./pages/Morning"));
const Growth = lazy(() => import("./pages/Growth"));
const MediaPlans = lazy(() => import("./pages/MediaPlans"));
const Playbooks = lazy(() => import("./pages/Playbooks"));
const WebAnalytics = lazy(() => import("./pages/WebAnalytics"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Library = lazy(() => import("./pages/Library"));
const System = lazy(() => import("./pages/System"));
const ListeningControl = lazy(() => import("./pages/ListeningControl"));
const Governance = lazy(() => import("./pages/Governance"));


// ── Wave 3·A · report browser faults the server never saw ────────────
// Half of "it's broken" is a render error. Fire-and-forget, deduped in
// this session so one broken component can't flood the log.
const reported = new Set<string>();
function reportClientError(message: string, stack?: string) {
  const key = `${message}`.slice(0, 120);
  if (reported.has(key) || reported.size > 20) return;
  reported.add(key);
  fetch("/api/public/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: key, route: window.location.pathname, stack: stack?.slice(0, 2000) }),
  }).catch(() => { /* never let error reporting cause an error */ });
}
if (typeof window !== "undefined") {
  window.addEventListener("error", (e) => reportClientError(e.message, e.error?.stack));
  window.addEventListener("unhandledrejection", (e) =>
    reportClientError(`Unhandled rejection: ${String((e as PromiseRejectionEvent).reason).slice(0, 200)}`));
}

export default function App() {
  const { user, loading, isAdmin } = useAuth();
  const { needsSetup, onboarded, moduleOn, ready } = useBranding();
  const { tr } = useI18n();
  const loc = useLocation();

  // Public surfaces live OUTSIDE the auth shell: the vendor portal
  // (magic link is the key) and the shareable Brand Center.
  if (loc.pathname.startsWith("/p/")) return <Portal token={loc.pathname.slice(3)} />;
  if (loc.pathname === "/brand") return <BrandCenter />;
  if (loc.pathname.startsWith("/f/")) return <FormPublic slug={loc.pathname.slice(3)} />;
  if (loc.pathname.startsWith("/l/")) return <LandingPublic slug={loc.pathname.slice(3)} />;
  if (loc.pathname.startsWith("/s/")) return <SurveyPublic slug={loc.pathname.slice(3)} />;
  if (loc.pathname.startsWith("/b/")) return <BioPublic slug={loc.pathname.slice(3)} />;
  if (loc.pathname.startsWith("/privacy/confirm/")) {
    const [, , , id, token] = loc.pathname.split("/");
    return <PrivacyConfirm id={id || ""} token={token || ""} />;
  }

  if (loading || !ready) {
    return (
      <div className="grid h-screen place-items-center bg-paper">
        <EcgLoader label={tr("loading")} />
      </div>
    );
  }

  // Fresh instance, zero users: the built-in installer creates the first admin.
  if (needsSetup) return <Setup />;

  if (!user) return <Login />;

  // Forced rotation: an admin reset this password — nothing else until it changes.
  if (user.mustChangePassword) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <SecurityModal open forced onClose={() => {}} />
      </div>
    );
  }

  // First run: the admin shapes the instance before anyone works in it.
  if (isAdmin && !onboarded) return <Onboarding />;

  return (
    <Layout>
      <Suspense fallback={<div className="grid min-h-64 place-items-center"><EcgLoader label={tr("loading")} /></div>}>
        <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        {moduleOn("planning") && <Route path="/planning" element={<Planning />} />}
        {moduleOn("brain") && <Route path="/brain" element={<Brain />} />}
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignRoom />} />
        <Route path="/products" element={<Products />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/links" element={<Links />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/operations" element={<Operations />} />
        <Route path="/imports" element={<Operations />} />
        {moduleOn("publish") && <Route path="/publish" element={<Publish />} />}
        {moduleOn("automate") && <Route path="/automate" element={<Automate />} />}
        {moduleOn("reach") && <Route path="/reach" element={<Reach />} />}
        <Route path="/morning" element={<Morning />} />
        {moduleOn("media") && <Route path="/media-plans" element={<MediaPlans />} />}
        {moduleOn("planning") && <Route path="/growth" element={<Growth />} />}
        {moduleOn("brain") && <Route path="/playbooks" element={<Playbooks />} />}
        {moduleOn("intel") && <Route path="/web" element={<WebAnalytics />} />}
        {moduleOn("social") && <Route path="/inbox" element={<Inbox />} />}
        {moduleOn("content") && <Route path="/library" element={<Library />} />}
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<Leads />} />
        <Route path="/customers" element={<Customers />} />
        {moduleOn("events") && <Route path="/events" element={<Events />} />}
        <Route path="/budget" element={<Budget />} />
        <Route path="/tasks" element={<Tasks />} />
        {moduleOn("social") && <Route path="/social" element={<Social />} />}
        {moduleOn("media") && <Route path="/media" element={<Media />} />}
        {moduleOn("listening") && <Route path="/listening" element={<Listening />} />}
        {moduleOn("listening") && <Route path="/listening-control" element={<ListeningControl />} />}
        {moduleOn("intel") && <Route path="/intel" element={<Intel />} />}
        {moduleOn("studio") && <Route path="/studio" element={<Studio />} />}
        {moduleOn("agency") && <Route path="/agency" element={<Agency />} />}
        <Route path="/contacts" element={<Contacts />} />
        {moduleOn("automate") && <Route path="/forms" element={<Forms />} />}
        {moduleOn("automate") && <Route path="/pages" element={<Pages />} />}
        {moduleOn("research") && <Route path="/surveys" element={<Surveys />} />}
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/report" element={<Report />} />
        <Route path="/governance" element={<Governance />} />
        {isAdmin && <Route path="/users" element={<Users />} />}
        {isAdmin && <Route path="/settings" element={<Settings />} />}
        {isAdmin && <Route path="/system" element={<System />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
