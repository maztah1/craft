import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authService } from '@/services/auth.service';
import { withRateLimit } from '@/lib/api/with-rate-limit';
import { AUTH_RATE_LIMIT } from '@/lib/api/rate-limit';

const resetPasswordSchema = z.object({
    email: z.string().email(),
});

/**
 * POST /api/auth/reset-password
 * Sends a password-reset email to the given address.
 * Always returns 200 regardless of whether the email exists (prevents enumeration).
 * Rate limited: 10 requests per 15 minutes per IP (see AUTH_RATE_LIMIT).
 */
export const POST = withRateLimit('auth:reset-password', AUTH_RATE_LIMIT)(
    async (req: NextRequest) => {
        const body = await req.json();
        const parsed = resetPasswordSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        try {
            await authService.resetPassword(parsed.data.email);
        } catch {
            // Swallow errors to avoid leaking whether the email exists.
            // The Supabase call itself is fire-and-forget for unregistered emails.
        }

        // Always return 200 to prevent email enumeration.
        return NextResponse.json({ message: 'If an account exists, a reset link has been sent.' });
    }
);
