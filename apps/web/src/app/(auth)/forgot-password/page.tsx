import type { Metadata } from 'next';
import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata: Metadata = {
    title: 'Reset password – CRAFT',
    description: 'Reset your CRAFT account password.',
};

export default function ForgotPasswordPage() {
    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold font-headline text-on-surface">
                    Reset your password
                </h1>
                <p className="mt-1 text-sm text-on-surface-variant">
                    Enter your email and we&apos;ll send you a reset link.
                </p>
            </div>
            <ForgotPasswordForm />
        </div>
    );
}
