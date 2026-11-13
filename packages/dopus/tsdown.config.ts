import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/cli.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node22',
    dts: true,
    clean: true,
    fixedExtension: false,
  },
  {
    // One config for both client entries so code they share lands in a shared chunk. Every output file,
    // chunks included, is a client module.
    entry: { react: 'src/react/index.ts', plugins: 'src/plugins/index.ts' },
    format: 'esm',
    platform: 'neutral',
    dts: true,
    clean: false,
    fixedExtension: false,
    banner: "'use client'",
    deps: {
      neverBundle: [
        'react',
        'react-dom',
        '@ai-sdk/react',
        'next',
        'react-markdown',
        'remark-gfm',
        'ai',
        'zod',
      ],
    },
  },
])
