'use server';

export interface ForgotPasswordState {
    status: 'idle' | 'success' | 'error';
    message: string;
}

/**
 * Server Action: calls POST /api/auth/reset-password.
 * Returns a serialisable state object consumed by the ForgotPasswordForm client component.
 *
 * Error copy mapping:
 *  - 429 → "Too many requests. Please wait a few minutes."
 *  - Network error → "Network error. Please try again."
 *  - Other → API message or generic fallback
 *
 * Note: The API returns 200 even if the email doesn't exist (prevents enumeration).
 */
export async function forgotPasswordAction(
    _prev: ForgotPasswordState,
    formData: FormData
): Promise<ForgotPasswordState> {
    const email = (formData.get('email') as string)?.trim();

    if (!email) {
        return { status: 'error', message: 'Email address is required.' };
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return { status: 'error', message: 'Please enter a valid email address.' };
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
    } catch {
        return { status: 'error', message: 'Network error. Please try again.' };
    }

    if (res.ok) {
        return {
            status: 'success',
            message: 'Check your email for a password reset link.',
        };
    }

    if (res.status === 429) {
        return { status: 'error', message: 'Too many requests. Please wait a few minutes.' };
    }

    const body = await res.json().catch(() => ({}));
    return {
        status: 'error',
        message: body.error ?? 'Something went wrong. Please try again.',
    };
}
