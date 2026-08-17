/**
 * An original geometric seal mark for the fictional "National Data
 * Governance Authority" used in this demo — deliberately NOT a
 * reproduction of any real government emblem, crest, or insignia.
 * The motif (concentric ring + fingerprint-like arcs) ties back to the
 * system's actual function: verifying data identity/authenticity.
 */
export default function Seal({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="19" stroke="#0D1526" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="15.5" stroke="#0D1526" strokeWidth="0.75" strokeDasharray="1.5 2" />
      {/* Fingerprint-style concentric arcs — echoes the hashing/fingerprinting theme */}
      <path d="M20 10a10 10 0 0 1 8.66 15" stroke="#14B8A6" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M20 13.5a6.5 6.5 0 0 1 5.6 9.7" stroke="#14B8A6" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M20 17a3 3 0 0 1 2.4 4.5" stroke="#14B8A6" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M20 10a10 10 0 0 0 -8.66 15" stroke="#0D1526" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M20 13.5a6.5 6.5 0 0 0 -5.6 9.7" stroke="#0D1526" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M20 17a3 3 0 0 0 -2.4 4.5" stroke="#0D1526" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="20" cy="20" r="1.4" fill="#F59E0B" />
      <text
        x="20"
        y="31.5"
        textAnchor="middle"
        fontSize="5"
        fontFamily="'JetBrains Mono', monospace"
        fill="#0D1526"
        letterSpacing="0.5"
      >
        DDAS
      </text>
    </svg>
  );
}
