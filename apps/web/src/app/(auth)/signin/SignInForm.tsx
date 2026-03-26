'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signInAction, type SignInState } from './actions';

const initialState: SignInState = { status: 'idle', message: '' };

/**
 * --------------------------------------------------------------------------
 * Error Copy & Edge Cases
 * --------------------------------------------------------------------------
 * - Invalid credentials (401)     → "Invalid email or password. Please try again."
 * - User not found                → "No account found with this email."
 * - Email not confirmed           → "Please confirm your email address before signing in."
 * - Network failure               → "Network error. Please try again."
 * - Rate limited (429)            → "Too many sign-in attempts. Please wait a few minutes."
 * - Generic API error             → message from API or "Something went wrong. Please try again."
 * - Success                       → redirect to /app (handled in server action)
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
            {pending ? 'Signing in…' : 'Sign in'}
        </button>
    );
}

function PasswordInput({ disabled }: { disabled: boolean }) {
    const [visible, setVisible] = useState(false);

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-on-surface">
                    Password
                </label>
                <Link
                    href="/forgot-password"
                    className="text-xs font-medium text-surface-tint hover:underline focus:outline-none focus:ring-2 focus:ring-surface-tint rounded"
                    tabIndex={0}
                >
                    Forgot password?
                </Link>
            </div>
            <div className="relative">
                <input
                    id="password"
                    name="password"
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    aria-required="true"
                    disabled={disabled}
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest
                               px-3 py-2 pr-10 text-sm text-on-surface shadow-sm
                               placeholder:text-on-surface-variant/50
                               focus:outline-none focus:ring-2 focus:ring-surface-tint focus:border-surface-tint
                               disabled:opacity-50 transition-colors"
                />
                <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-on-surface-variant
                               hover:text-on-surface focus:outline-none focus:text-on-surface"
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                >
                    {visible ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.5 6.5m7.378 7.378L17.5 17.5M3 3l18 18" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}

export default function SignInForm() {
    const [state, formAction] = useFormState(signInAction, initialState);
    const { pending } = { pending: false }; // For field-level usage outside FormStatus context

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

            <PasswordInput disabled={false} />

            {state.status === 'error' && (
                <div role="alert" className="rounded-lg bg-error-container/50 border border-error/20 px-3 py-2">
                    <p className="text-sm text-on-error-container">{state.message}</p>
                </div>
            )}

            <SubmitButton />

            <p className="text-center text-sm text-on-surface-variant">
                Don&apos;t have an account?{' '}
                <Link
                    href="/signup"
                    className="font-medium text-surface-tint hover:underline focus:outline-none focus:ring-2 focus:ring-surface-tint rounded"
                >
                    Sign up
                </Link>
            </p>
        </form>
    );
}
