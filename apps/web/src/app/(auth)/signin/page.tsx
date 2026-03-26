import type { Metadata } from 'next';
import SignInForm from './SignInForm';

export const metadata: Metadata = {
    title: 'Sign in – CRAFT',
    description: 'Sign in to your CRAFT account to manage your Stellar DeFi deployments.',
};

export default function SignInPage() {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold font-headline text-on-surface">
                    Welcome back
                </h1>
                <p className="mt-1 text-sm text-on-surface-variant">
                    Sign in to continue to CRAFT.
                </p>
            </div>
            <SignInForm />
        </div>
    );
}
