/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#090C12", 900: "#0E1117", 800: "#161B22", 700: "#1F2630", 600: "#2B3441", 500: "#3A4654", 400: "#5C6878", 300: "#8A94A3" },
        paper: { DEFAULT: "#F7F5F0", 100: "#FBF9F5", 200: "#EFECE3", 300: "#E2DED2" },
        amber: { DEFAULT: "#E8A33D", 50: "#FCF3E1", 300: "#F3C275", 400: "#EDB05A", 500: "#E8A33D", 600: "#CC8526", 700: "#A5681B" },
        steel: { 400: "#5B8AA6", 500: "#3F7191", 600: "#2F5871" },
        moss: { 500: "#5E8B5A", 600: "#477043" },
        clay: { 500: "#C2603E", 600: "#A24A2C" },
        violet: { 500: "#7A6CA8", 600: "#5F5188" },
        teal: { 500: "#3E8F8A", 600: "#2C6E6A" },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', "system-ui", "sans-serif"],
        ar: ['"IBM Plex Sans Arabic"', '"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["2.25rem", { lineHeight: "1.1", fontWeight: "700" }],
        h1: ["1.5rem", { lineHeight: "1.2", fontWeight: "700" }],
        h2: ["1.25rem", { lineHeight: "1.25", fontWeight: "600" }],
        h3: ["1rem", { lineHeight: "1.3", fontWeight: "600" }],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,17,23,0.04), 0 4px 16px rgba(16,17,23,0.06)",
        raised: "0 2px 4px rgba(16,17,23,0.06), 0 8px 24px rgba(16,17,23,0.10)",
        overlay: "0 12px 48px rgba(11,14,19,0.28)",
        rail: "inset -1px 0 0 rgba(255,255,255,0.05), inset 0 -40px 60px -40px rgba(232,163,61,0.06)",
      },
      borderRadius: { xl2: "1.1rem" },
      transitionTimingFunction: {
        productive: "cubic-bezier(.2,0,.38,.9)",
        expressive: "cubic-bezier(.4,.14,.3,1)",
      },
      transitionDuration: { fast: "150ms", base: "200ms", slow: "240ms" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms cubic-bezier(.2,0,.38,.9)",
        "scale-in": "scale-in 200ms cubic-bezier(.4,.14,.3,1)",
      },
    },
  },
  plugins: [],
};
