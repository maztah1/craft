import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
    return (
        <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-8 sm:py-12">
            {/* Branding */}
            <Link
                href="/"
                className="mb-8 flex items-center gap-2 text-on-surface focus:outline-none focus:ring-2 focus:ring-surface-tint rounded-md"
                aria-label="CRAFT home"
            >
                <svg
                    width="32"
                    height="32"
                    viewBox="0 0 32 32"
                    fill="none"
                    aria-hidden="true"
                    className="shrink-0"
                >
                    <rect width="32" height="32" rx="8" className="fill-primary" />
                    <path
                        d="M10 16L14 20L22 12"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                <span className="text-xl font-bold font-headline tracking-tight">CRAFT</span>
            </Link>

            {/* Auth Card */}
            <div className="w-full max-w-md rounded-xl bg-surface-container-lowest shadow-lg border border-outline-variant/30 p-6 sm:p-8">
                {children}
            </div>

            {/* Footer */}
            <p className="mt-6 text-xs text-on-surface-variant text-center">
                &copy; {new Date().getFullYear()} CRAFT Platform. All rights reserved.
            </p>
        </main>
    );
}
