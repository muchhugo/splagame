import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Raiz do monorepo: o Turbopack precisa enxergar packages/* (fonte TS dos pacotes do workspace).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Não gerar AGENTS.md/CLAUDE.md no diretório do app a cada `next dev`.
  agentRules: false,
  // Pacotes do workspace exportam TypeScript direto da fonte.
  transpilePackages: ['@borrifo/activity-sdk', '@borrifo/game-contracts'],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // O host do laboratório não deve ser embutido por ninguém.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Microfone só para o próprio host (a Atividade não recebe); câmera e geolocalização desligadas.
          { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
