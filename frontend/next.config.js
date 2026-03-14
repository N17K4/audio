/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  assetPrefix: './',
  trailingSlash: true,
  images: { unoptimized: true },
};

module.exports = nextConfig;
