'use client';

import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { forgotPasswordAction, type ForgotPasswordState } from './actions';

const initialState: ForgotPasswordState = { status: 'idle', message: '' };

/**
 * --------------------------------------------------------------------------
 * Error Copy & Edge Cases
 * --------------------------------------------------------------------------
 * - Empty email                   → "Email address is required."
 * - Invalid email format          → (handled by HTML5 validation + server action)
 * - Rate-limited (429)            → "Too many requests. Please wait a few minutes."
 * - Network failure               → "Network error. Please try again."
 * - Generic API error             → message from API or "Something went wrong. Please try again."
 * - Success                       → "Check your email for a reset link."
 *
 * Note: We intentionally show a success message even if the email doesn't exist
 *       in our system (security best practice to prevent email enumeration).
 * --------------------------------------------------------------------------
 */

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="w-full rounded-lg bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-on-primary
                       hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-surface-tint focus:ring-offset-2
                       disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200
                       flex items-center justify-center gap-2"
        >
            {pending && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
            )}
            {pending ? 'Sending link…' : 'Send reset link'}
        </button>
    );
}

export default function ForgotPasswordForm() {
    const [state, formAction] = useFormState(forgotPasswordAction, initialState);

    if (state.status === 'success') {
        return (
            <div role="status" className="text-center space-y-3 py-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                    <svg className="h-6 w-6 text-surface-tint" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                </div>
                <p className="text-sm font-medium text-on-surface">{state.message}</p>
                <p className="text-xs text-on-surface-variant">
                    Didn&apos;t receive the email? Check your spam folder or try again.
                </p>
                <Link
                    href="/signin"
                    className="inline-block text-sm font-medium text-surface-tint hover:underline focus:outline-none focus:ring-2 focus:ring-surface-tint rounded"
                >
                    ← Back to sign in
                </Link>
            </div>
        );
    }

    return (
        <form action={formAction} noValidate className="space-y-4">
            <div>
                <label htmlFor="email" className="block text-sm font-medium text-on-surface mb-1">
                    Email address
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    aria-required="true"
                    placeholder="you@company.com"
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest
                               px-3 py-2 text-sm text-on-surface shadow-sm
                               placeholder:text-on-surface-variant/50
                               focus:outline-none focus:ring-2 focus:ring-surface-tint focus:border-surface-tint
                               disabled:opacity-50 transition-colors"
                />
            </div>

            {state.status === 'error' && (
                <div role="alert" className="rounded-lg bg-error-container/50 border border-error/20 px-3 py-2">
                    <p className="text-sm text-on-error-container">{state.message}</p>
                </div>
            )}

            <SubmitButton />

            <p className="text-center text-sm text-on-surface-variant">
                Remember your password?{' '}
                <Link
                    href="/signin"
                    className="font-medium text-surface-tint hover:underline focus:outline-none focus:ring-2 focus:ring-surface-tint rounded"
                >
                    Sign in
                </Link>
            </p>
        </form>
    );
}
