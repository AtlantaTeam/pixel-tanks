import type { NextConfig } from 'next';
import path from 'path';
import { withPayload } from '@payloadcms/next/withPayload';

const nextConfig: NextConfig = {
    output: 'standalone',
    reactCompiler: true,
    turbopack: {
        root: path.resolve(__dirname),
    },
    images: {
        unoptimized: process.env.NODE_ENV === 'development',
    },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
