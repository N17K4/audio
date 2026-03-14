/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  assetPrefix: './',
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    root: '../',
  },
};

module.exports = nextConfig;
