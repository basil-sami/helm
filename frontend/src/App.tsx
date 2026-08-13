import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useI18n } from "./context/I18nContext";
import { useBranding } from "./context/BrandingContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Onboarding from "./pages/Onboarding";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import Planning from "./pages/Planning";
import Listening from "./pages/Listening";
import Brain from "./pages/Brain";
import Campaigns from "./pages/Campaigns";
import Calendar from "./pages/Calendar";
import Leads from "./pages/Leads";
import Events from "./pages/Events";
import Budget from "./pages/Budget";
import Tasks from "./pages/Tasks";
import Social from "./pages/Social";
import Intel from "./pages/Intel";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Products from "./pages/Products";
import Audience from "./pages/Audience";
import Links from "./pages/Links";
import Customers from "./pages/Customers";
import Media from "./pages/Media";
import Report from "./pages/Report";
import Studio from "./pages/Studio";
import Agency from "./pages/Agency";
import Approvals from "./pages/Approvals";
import Portal from "./pages/Portal";
import BrandCenter from "./pages/BrandCenter";
import Contacts from "./pages/Contacts";
import Forms from "./pages/Forms";
import Pages from "./pages/Pages";
import Surveys from "./pages/Surveys";
import FormPublic from "./pages/FormPublic";
import LandingPublic from "./pages/LandingPublic";
import SurveyPublic from "./pages/SurveyPublic";
import BioPublic from "./pages/BioPublic";
import Publish from "./pages/Publish";
import Automate from "./pages/Automate";
import Reach from "./pages/Reach";
import Morning from "./pages/Morning";
import Growth from "./pages/Growth";
import MediaPlans from "./pages/MediaPlans";
import Playbooks from "./pages/Playbooks";
import WebAnalytics from "./pages/WebAnalytics";
import Inbox from "./pages/Inbox";
import Library from "./pages/Library";
import System from "./pages/System";
import SecurityModal from "./components/SecurityModal";
import { EcgLoader } from "./components/PulseMark";


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
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        {moduleOn("planning") && <Route path="/planning" element={<Planning />} />}
        {moduleOn("brain") && <Route path="/brain" element={<Brain />} />}
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/products" element={<Products />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/links" element={<Links />} />
        <Route path="/calendar" element={<Calendar />} />
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
        <Route path="/customers" element={<Customers />} />
        {moduleOn("events") && <Route path="/events" element={<Events />} />}
        <Route path="/budget" element={<Budget />} />
        <Route path="/tasks" element={<Tasks />} />
        {moduleOn("social") && <Route path="/social" element={<Social />} />}
        {moduleOn("media") && <Route path="/media" element={<Media />} />}
        {moduleOn("listening") && <Route path="/listening" element={<Listening />} />}
        {moduleOn("intel") && <Route path="/intel" element={<Intel />} />}
        {moduleOn("studio") && <Route path="/studio" element={<Studio />} />}
        {moduleOn("agency") && <Route path="/agency" element={<Agency />} />}
        <Route path="/contacts" element={<Contacts />} />
        {moduleOn("automate") && <Route path="/forms" element={<Forms />} />}
        {moduleOn("automate") && <Route path="/pages" element={<Pages />} />}
        {moduleOn("research") && <Route path="/surveys" element={<Surveys />} />}
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/report" element={<Report />} />
        {isAdmin && <Route path="/users" element={<Users />} />}
        {isAdmin && <Route path="/settings" element={<Settings />} />}
        {isAdmin && <Route path="/system" element={<System />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
