/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        s1: "var(--surface-1)",
        s2: "var(--surface-2)",
        s3: "var(--surface-3)",
        line: "var(--border)",
        t1: "var(--text-1)",
        t2: "var(--text-2)",
        tm: "var(--text-muted)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        good: "var(--good)",
        warn: "var(--warning)",
        serious: "var(--serious)",
        crit: "var(--critical)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      borderRadius: { xl2: "1.25rem" },
      boxShadow: {
        card: "var(--shadow-card)",
        glow: "var(--shadow-glow)",
      },
    },
  },
  plugins: [],
};
