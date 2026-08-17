/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // "Control room" ink — sidebar, chrome, headers
        ink: {
          950: "#0A0F1C",
          900: "#0D1526",
          800: "#131E33",
          700: "#1B2A45",
          600: "#28395A",
        },
        // Cool light workspace — content surfaces
        surface: {
          50: "#F5F7FA",
          100: "#ECEFF4",
          200: "#DDE3EC",
        },
        // Verified / fingerprint-match accent
        verify: {
          400: "#2DD4BF",
          500: "#14B8A6",
          600: "#0D9488",
        },
        // Duplicate-alert accent
        alert: {
          400: "#FBBF24",
          500: "#F59E0B",
          600: "#D97706",
        },
        // Deny / access-denied accent
        deny: {
          500: "#E11D48",
          600: "#BE123C",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        sm: "3px",
      },
    },
  },
  plugins: [],
};
