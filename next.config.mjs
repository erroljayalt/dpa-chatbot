/** @type {import('next').NextConfig} */
const nextConfig = {
  // Make sure the pre-built search index ships with the serverless function.
  outputFileTracingIncludes: {
    "/api/chat": ["./data/index.json"],
  },
};

export default nextConfig;
