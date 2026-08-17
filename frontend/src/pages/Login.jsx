import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import Seal from "../components/Seal";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/search");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col">
      <div className="px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-surface-200/70 hover:text-surface-50">
          <ArrowLeft size={14} />
          Back to homepage
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-3">
              <Seal size={52} />
            </div>
            <div className="font-display font-semibold text-2xl text-surface-50 tracking-tight">
              Departmental Sign-In
            </div>
            <div className="text-xs text-ink-600 mt-1">
              Data Download &amp; Duplication Alert System
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-ink-900 border border-ink-700 rounded-sm p-6 space-y-4"
          >
            <div>
              <label className="block text-xs font-medium text-surface-200/70 mb-1.5">
                Official email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-ink-800 border border-ink-700 rounded-sm px-3 py-2 text-surface-50 text-sm focus:border-verify-500 outline-none"
                placeholder="you@department.gov.in"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-200/70 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-ink-800 border border-ink-700 rounded-sm px-3 py-2 text-surface-50 text-sm focus:border-verify-500 outline-none"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-sm text-deny-500 bg-deny-500/10 border border-deny-500/30 rounded-sm px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-verify-500 hover:bg-verify-600 disabled:opacity-50 text-ink-950 font-medium text-sm py-2.5 rounded-sm transition-colors"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="text-center text-xs text-ink-600 mt-5">
            Trouble signing in? Contact{" "}
            <span className="tag-mono">helpdesk@ddas.gov.in</span>
          </div>
        </div>
      </div>
    </div>
  );
}
