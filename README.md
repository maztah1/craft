# CRAFT Platform

A no-code platform for deploying customized DeFi applications on the Stellar blockchain.

## Project Structure

```
craft-platform/
├── apps/
│   ├── web/                 # Main Next.js application
│   └── generator/           # Template generation service
├── packages/
│   ├── types/              # Shared TypeScript types
│   ├── ui/                 # Shared UI components
│   ├── stellar/            # Stellar SDK wrapper
│   └── config/             # Shared configuration
└── templates/              # Base template repositories
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm 10+

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values:

- Supabase credentials
- GitHub token
- Vercel token
- Stripe keys

## Tech Stack

- **Frontend**: Next.js 14, React 18, TailwindCSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Vercel
- **Payments**: Stripe
- **Blockchain**: Stellar SDK
- **Monorepo**: Turborepo

## License

Private - All Rights Reserved
