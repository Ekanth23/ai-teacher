/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand accent — calm, trustworthy, educational indigo.
        primary: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        // Neutral surface/text hierarchy (slate-like).
        neutral: {
          50: "#F8FAFC",
          100: "#F1F5F9",
          200: "#E2E8F0",
          300: "#CBD5E1",
          400: "#94A3B8",
          500: "#64748B",
          600: "#475569",
          700: "#334155",
          800: "#1E293B",
          900: "#0F172A",
          950: "#020617",
        },
        // Semantic states.
        success: {
          DEFAULT: "#059669",
          hover: "#047857",
          subtle: "#ECFDF5",
          content: "#065F46",
        },
        warning: {
          DEFAULT: "#D97706",
          hover: "#B45309",
          subtle: "#FFFBEB",
          content: "#92400E",
        },
        error: {
          DEFAULT: "#DC2626",
          hover: "#B91C1C",
          subtle: "#FEF2F2",
          content: "#991B1B",
        },
        info: {
          DEFAULT: "#0284C7",
          hover: "#0369A1",
          subtle: "#F0F9FF",
          content: "#075985",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
