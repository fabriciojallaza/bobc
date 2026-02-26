# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BOBC (Digital Bolivianos) is a regulated Bolivian stablecoin platform — a frontend-only React application for 1:1 backed digital currency minting, redemption, and transparency tracking. No backend exists in this repo; transaction data uses localStorage and mock data.

## Build & Development

All commands run from `frontend/`:

```bash
cd frontend
pnpm install        # install dependencies (pnpm is the package manager)
pnpm run build      # production build via Vite
```

No dev server script, test runner, or linter is currently configured.

## Architecture

### Routing & App Shell

The app uses **state-based routing** (not React Router file-based routing). `App.tsx` holds a `useState<'home' | 'buy' | 'dashboard' | 'transparency'>` and renders pages via a switch statement. Navigation is passed down as `onNavigate` props. The app is wrapped in `WagmiProvider` and `QueryClientProvider` at the root.

### Key Directories

- `frontend/src/app/components/` — Page components (LandingPage, BuyPage, DashboardPage, TransparencyPage) plus Header/Footer
- `frontend/src/app/components/ui/` — Shadcn/Radix UI component library (~50 components, Tailwind-styled)
- `frontend/src/app/config/` — Wagmi Web3 config (Mainnet + Polygon, injected wallet connector)
- `frontend/src/styles/` — Global CSS: theme variables, Tailwind directives, fonts (Inter)

### Web3 Integration

Uses Wagmi v3 with Viem. Configured for Ethereum Mainnet and Polygon via injected wallet (MetaMask). No on-chain contract interaction code exists yet — wallet connection/disconnection only.

### Styling

- Tailwind CSS v4 with `@tailwindcss/vite` plugin
- CSS custom properties in `theme.css` for theming (light/dark mode support)
- `cn()` utility (`ui/utils.ts`) combines `clsx` + `tailwind-merge` for conditional class composition
- Brand colors: primary `#0B1C2D` (dark blue), accent `#16C784` (green)

### UI Components

Shadcn/Radix UI pattern: headless Radix primitives styled with Tailwind via `class-variance-authority`. All located in `ui/` directory. Use existing components before creating new ones.

## Conventions

- Functional components with hooks, PascalCase filenames
- Props interfaces named `{ComponentName}Props`
- Path alias: `@` resolves to `frontend/src/`
- Vite config: SVG and CSV files are configured for raw imports; never add CSS/TS/TSX to `assetsInclude`
