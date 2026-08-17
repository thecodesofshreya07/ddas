import { Link } from "react-router-dom";
import { Search as SearchIcon } from "lucide-react";
import Seal from "./Seal";

/**
 * Public-facing header, styled to the conventions of an official
 * e-governance portal: a slim utility bar (accessibility / language),
 * an identity strip (seal + department name), and a tricolour accent —
 * a common visual convention on Indian government sites, rendered here
 * as an abstract accent bar, not a reproduction of any official emblem.
 */
export default function Header() {
  return (
    <header>
      {/* Utility bar */}
      <div className="bg-ink-950 text-surface-200/70 text-xs">
        <div className="max-w-6xl mx-auto px-6 py-1.5 flex items-center justify-between">
          <a href="#main-content" className="hover:text-surface-50">
            Skip to main content
          </a>
          <div className="flex items-center gap-4">
            <button className="hover:text-surface-50">Screen Reader Access</button>
            <span className="text-ink-700">|</span>
            <button className="hover:text-surface-50">A− A A+</button>
            <span className="text-ink-700">|</span>
            <select className="bg-transparent hover:text-surface-50 outline-none cursor-pointer">
              <option className="text-ink-950">English</option>
              <option className="text-ink-950">हिन्दी</option>
            </select>
          </div>
        </div>
      </div>

      {/* Identity strip */}
      <div className="bg-white border-b border-ink-200">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <Seal size={44} />
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-600 font-medium">
                National Data Governance Authority
              </div>
              <div className="font-display font-semibold text-lg text-ink-950 leading-tight">
                Data Download &amp; Duplication Alert System
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-ink-700">
            <a href="/#about" className="hover:text-verify-600">
              About
            </a>
            <a href="/#features" className="hover:text-verify-600">
              Features
            </a>
            <a href="/#contact" className="hover:text-verify-600">
              Contact
            </a>
            <Link
              to="/login"
              className="flex items-center gap-2 bg-ink-900 hover:bg-ink-800 text-surface-50 px-4 py-2 rounded-sm transition-colors"
            >
              <SearchIcon size={15} />
              Access Registry
            </Link>
          </nav>
        </div>
      </div>

      {/* Accent strip */}
      <div className="h-1 flex">
        <div className="flex-1 bg-alert-500" />
        <div className="flex-1 bg-ink-100" />
        <div className="flex-1 bg-verify-600" />
      </div>
    </header>
  );
}
