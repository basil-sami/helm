import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useI18n } from "./context/I18nContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
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
import SecurityModal from "./components/SecurityModal";

export default function App() {
  const { user, loading, isAdmin } = useAuth();
  const { tr } = useI18n();

  if (loading) {
    return (
      <div className="grid h-screen place-items-center bg-paper text-ink-500">{tr("loading")}</div>
    );
  }

  if (!user) return <Login />;

  // Forced rotation: an admin reset this password — nothing else until it changes.
  if (user.mustChangePassword) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper">
        <SecurityModal open forced onClose={() => {}} />
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/planning" element={<Planning />} />
        <Route path="/brain" element={<Brain />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/products" element={<Products />} />
        <Route path="/audience" element={<Audience />} />
        <Route path="/links" element={<Links />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/events" element={<Events />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/social" element={<Social />} />
        <Route path="/media" element={<Media />} />
        <Route path="/listening" element={<Listening />} />
        <Route path="/intel" element={<Intel />} />
        <Route path="/report" element={<Report />} />
        {isAdmin && <Route path="/users" element={<Users />} />}
        {isAdmin && <Route path="/settings" element={<Settings />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
