import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        canvas: "#f6f7f9",
        panel: "#f8f9fb",
        line: "#e5e7eb",
        accent: {
          DEFAULT: "#4f46e5",
          hover: "#4338ca",
          soft: "#eef2ff",
          line: "#c7d2fe",
          deep: "#312e81"
        },
        warn: "#b45309"
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        card: "0 1px 3px 0 rgb(15 23 42 / 0.04), 0 1px 2px -1px rgb(15 23 42 / 0.03)",
        pop: "0 18px 48px -20px rgb(15 23 42 / 0.28), 0 6px 16px -8px rgb(15 23 42 / 0.08)"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
