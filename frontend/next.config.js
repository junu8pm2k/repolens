/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the dev server output separate from production build artifacts.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  async redirects() {
    return [
      { source: "/chat", destination: "/?view=chat", permanent: false },
      { source: "/issues", destination: "/?view=issues", permanent: false },
      { source: "/pull-requests", destination: "/?view=pull-requests", permanent: false },
      { source: "/ci", destination: "/?view=ci", permanent: false },
      { source: "/rag", destination: "/knowledge?tab=qa", permanent: false },
      { source: "/repos/:repoId/assignees", destination: "/?view=team&repo=:repoId", permanent: false }
    ];
  },
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000"
  }
};

module.exports = nextConfig;
