import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The page's metadata depends on ?project=, which makes it async, and
  // async metadata is streamed to browsers at the end of the body unless the
  // visitor matches this pattern. Ours is computed from the URL alone, so
  // waiting for it costs nothing: every visitor gets the title, description
  // and preview tags in the <head>, not only the link-preview bots.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
