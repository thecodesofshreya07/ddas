import { Mail, Phone, MapPin } from "lucide-react";

export default function Footer() {
  return (
    <footer className="bg-ink-950 text-surface-200/70">
      <div className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-4 gap-10">
        <div>
          <div className="font-display font-semibold text-surface-50 text-sm mb-3">
            National Data Governance Authority
          </div>
          <p className="text-xs leading-relaxed">
            The Data Download &amp; Duplication Alert System (DDAS) helps departments and
            research bodies discover and reuse existing datasets before re-collecting or
            re-downloading them — reducing redundant storage and bandwidth use across
            government data infrastructure.
          </p>
        </div>

        <div>
          <div className="text-surface-50 text-sm font-medium mb-3">Quick links</div>
          <ul className="space-y-2 text-xs">
            <li><a href="/#about" className="hover:text-surface-50">About the system</a></li>
            <li><a href="/#features" className="hover:text-surface-50">Features</a></li>
            <li><a href="/login" className="hover:text-surface-50">Departmental login</a></li>
            <li><a href="/#contact" className="hover:text-surface-50">Contact support</a></li>
          </ul>
        </div>

        <div>
          <div className="text-surface-50 text-sm font-medium mb-3">Policies</div>
          <ul className="space-y-2 text-xs">
            <li><a href="#" className="hover:text-surface-50">Terms of use</a></li>
            <li><a href="#" className="hover:text-surface-50">Data privacy policy</a></li>
            <li><a href="#" className="hover:text-surface-50">Accessibility statement</a></li>
            <li><a href="#" className="hover:text-surface-50">Right to Information</a></li>
          </ul>
        </div>

        <div id="contact">
          <div className="text-surface-50 text-sm font-medium mb-3">Helpdesk</div>
          <ul className="space-y-2.5 text-xs">
            <li className="flex items-start gap-2">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              <span>Data Governance Bhawan, Sector 9,<br />New Delhi – 110001</span>
            </li>
            <li className="flex items-center gap-2">
              <Phone size={14} className="shrink-0" />
              <span className="tag-mono">1800-11-XXXX (toll-free)</span>
            </li>
            <li className="flex items-center gap-2">
              <Mail size={14} className="shrink-0" />
              <span className="tag-mono">helpdesk@ddas.gov.in</span>
            </li>
            <li className="text-ink-600">Mon–Fri, 9:30 AM – 6:00 PM IST</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-800">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-2 text-[11px] text-ink-600">
          <span>
            © {new Date().getFullYear()} National Data Governance Authority. Built for Smart
            India Hackathon — demonstration system, not an active government deployment.
          </span>
          <span className="tag-mono">Last updated: {new Date().toLocaleDateString("en-IN")}</span>
        </div>
      </div>
    </footer>
  );
}
