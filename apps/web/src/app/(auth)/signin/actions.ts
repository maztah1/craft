'use server';

import { redirect } from 'next/navigation';

export interface SignInState {
    status: 'idle' | 'success' | 'error';
    message: string;
}

/**
 * Server Action: calls POST /api/auth/signin.
 * Returns a serialisable state object consumed by the SignInForm client component.
 * On success, redirects to /app (dashboard).
 *
 * Error copy mapping:
 *  - 401 → "Invalid email or password. Please try again."
 *  - 429 → "Too many sign-in attempts. Please wait a few minutes."
 *  - Network error → "Network error. Please try again."
 *  - Other → API message or generic fallback
 */
export async function signInAction(
    _prev: SignInState,
    formData: FormData
): Promise<SignInState> {
    const email = (formData.get('email') as string)?.trim();
    const password = formData.get('password') as string;

    if (!email) {
        return { status: 'error', message: 'Email address is required.' };
    }

    if (!password) {
        return { status: 'error', message: 'Password is required.' };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
    } catch {
        return { status: 'error', message: 'Network error. Please try again.' };
    }

    if (res.ok) {
        redirect('/app');
    }

    const body = await res.json().catch(() => ({}));

    if (res.status === 401) {
        return {
            status: 'error',
            message: body.error?.includes('confirm')
                ? 'Please confirm your email address before signing in.'
                : 'Invalid email or password. Please try again.',
        };
    }

    if (res.status === 429) {
        return { status: 'error', message: 'Too many sign-in attempts. Please wait a few minutes.' };
    }

    return {
        status: 'error',
        message: body.error ?? 'Something went wrong. Please try again.',
    };
}
