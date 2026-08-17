import { useState } from "react";
import { NavLink, useNavigate, Link } from "react-router-dom";
import {
  Search as SearchIcon,
  UploadCloud,
  LayoutDashboard,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  HelpCircle,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Seal from "./Seal";

const links = [
  { to: "/search", label: "Search Registry", icon: SearchIcon, end: true, desc: "Find existing datasets" },
  { to: "/upload", label: "Upload Dataset", icon: UploadCloud, desc: "Add new data, checked automatically" },
  { to: "/alerts", label: "Alert Center", icon: ShieldAlert, desc: "Review detected duplicates" },
  { to: "/dashboard", label: "Reports & Impact", icon: LayoutDashboard, desc: "Storage & bandwidth saved" },
];

function NavItems({ user, onNavigate }) {
  return (
    <>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-start gap-3 px-3 py-2.5 rounded-sm transition-colors ${
              isActive ? "bg-verify-500/10 text-verify-700" : "text-ink-700 hover:bg-surface-100"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <l.icon size={17} className={`mt-0.5 shrink-0 ${isActive ? "text-verify-600" : "text-ink-600"}`} />
              <div>
                <div className="text-sm font-medium leading-tight">{l.label}</div>
                <div className="text-[11px] text-ink-600 mt-0.5">{l.desc}</div>
              </div>
            </>
          )}
        </NavLink>
      ))}

      {user?.role === "admin" && (
        <NavLink
          to="/audit"
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-start gap-3 px-3 py-2.5 rounded-sm transition-colors ${
              isActive ? "bg-verify-500/10 text-verify-700" : "text-ink-700 hover:bg-surface-100"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <ShieldCheck size={17} className={`mt-0.5 shrink-0 ${isActive ? "text-verify-600" : "text-ink-600"}`} />
              <div>
                <div className="text-sm font-medium leading-tight">Audit &amp; Compliance</div>
                <div className="text-[11px] text-ink-600 mt-0.5">Verify log integrity</div>
              </div>
            </>
          )}
        </NavLink>
      )}
    </>
  );
}

export default function Shell({ children, breadcrumb }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded-sm focus:text-sm"
      >
        Skip to main content
      </a>

      {/* Top identity bar */}
      <div className="bg-ink-950 border-b border-ink-800 text-white">
        <div className="px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setDrawerOpen(true)}
              className="md:hidden text-surface-50 p-2 -ml-2 hover:bg-ink-900 rounded"
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <Link to="/" className="flex items-center gap-2.5">
              <Seal size={30} />
              <div className="leading-tight">
                <div className="text-white font-display font-semibold text-sm tracking-wide">DDAS</div>
                <div className="text-[10px] text-cyan-400 font-mono hidden sm:block font-medium">Departmental Portal</div>
              </div>
            </Link>

            {/* Desktop Top Navbar Links */}
            <nav className="hidden lg:flex items-center gap-1 ml-4 border-l border-ink-800 pl-4">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-verify-500/20 text-teal-300 border border-teal-500/40"
                        : "text-slate-300 hover:text-white hover:bg-ink-900"
                    }`
                  }
                >
                  <l.icon size={14} className="shrink-0" />
                  <span>{l.label}</span>
                </NavLink>
              ))}
              {user?.role === "admin" && (
                <NavLink
                  to="/audit"
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-verify-500/20 text-teal-300 border border-teal-500/40"
                        : "text-slate-300 hover:text-white hover:bg-ink-900"
                    }`
                  }
                >
                  <ShieldCheck size={14} className="shrink-0" />
                  <span>Audit</span>
                </NavLink>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-3 md:gap-5">
            <button
              className="hidden sm:flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
              title="Help & documentation"
            >
              <HelpCircle size={14} />
              <span>Help</span>
            </button>
            <div className="h-4 w-px bg-ink-700 hidden sm:block" />
            <div className="text-right leading-tight hidden md:block">
              <div className="text-xs text-white font-semibold tracking-tight">{user?.name || user?.username}</div>
              <div className="text-[11px] text-teal-300 font-mono font-medium">
                {user?.department} · {user?.role}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-rose-400 transition-colors px-2 py-1 rounded hover:bg-ink-900"
              aria-label="Sign out"
            >
              <LogOut size={14} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>


      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-ink-950/50"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white flex flex-col">
            <div className="flex items-center justify-between px-4 h-14 border-b border-ink-200">
              <div className="flex items-center gap-2">
                <Seal size={26} />
                <span className="font-display font-semibold text-sm text-ink-950">DDAS Menu</span>
              </div>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close navigation menu" className="p-2">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              <NavItems user={user} onNavigate={() => setDrawerOpen(false)} />
            </nav>
            <div className="px-4 py-4 border-t border-ink-200">
              <div className="text-xs text-ink-900 font-medium">{user?.name}</div>
              <div className="text-[11px] text-ink-600 tag-mono mt-0.5">
                {user?.department} · {user?.role}
              </div>
              <button
                onClick={handleLogout}
                className="mt-3 flex items-center gap-1.5 text-xs text-deny-600"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-60 shrink-0 bg-white border-r border-ink-200 flex-col">
          <nav className="flex-1 px-3 py-5 space-y-1">
            <NavItems user={user} />
          </nav>
          <div className="px-4 py-4 border-t border-ink-200 text-[11px] text-ink-600">
            Need help? <span className="tag-mono">helpdesk@ddas.gov.in</span>
          </div>
        </aside>

        {/* Content */}
        <main id="main-content" className="flex-1 min-w-0">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">
            {breadcrumb && (
              <nav aria-label="Breadcrumb" className="text-xs text-ink-600 mb-4 flex items-center gap-1.5 tag-mono flex-wrap">
                {breadcrumb.map((b, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-ink-400">/</span>}
                    {b.to ? (
                      <Link to={b.to} className="hover:text-verify-600">
                        {b.label}
                      </Link>
                    ) : (
                      <span className="text-ink-950" aria-current="page">
                        {b.label}
                      </span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
