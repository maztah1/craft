import { createClient } from '@/lib/supabase/server';
import type { User, AuthResult, ProfileUpdate } from '@craft/types';

export class AuthService {
    /**
     * Sign up a new user with email and password
     */
    async signUp(email: string, password: string): Promise<AuthResult> {
        const supabase = createClient();

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });

        if (error) {
            return {
                user: null,
                session: null,
                error: {
                    code: error.code || 'SIGNUP_ERROR',
                    message: error.message,
                },
            };
        }

        if (!data.user) {
            return {
                user: null,
                session: null,
                error: {
                    code: 'NO_USER',
                    message: 'User creation failed',
                },
            };
        }

        // Create profile record
        const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            subscription_tier: 'free',
        });

        if (profileError) {
            return {
                user: null,
                session: null,
                error: {
                    code: 'PROFILE_CREATION_ERROR',
                    message: profileError.message,
                },
            };
        }

        return {
            user: {
                id: data.user.id,
                email: data.user.email!,
                createdAt: new Date(data.user.created_at),
                subscriptionTier: 'free',
                githubConnected: false,
            },
            session: data.session
                ? {
                    accessToken: data.session.access_token,
                    refreshToken: data.session.refresh_token,
                    expiresAt: new Date(data.session.expires_at! * 1000),
                }
                : null,
            error: null,
        };
    }

    /**
     * Sign in an existing user
     */
    async signIn(email: string, password: string): Promise<AuthResult> {
        const supabase = createClient();

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return {
                user: null,
                session: null,
                error: {
                    code: error.code || 'SIGNIN_ERROR',
                    message: this.getReadableErrorMessage(error.message),
                },
            };
        }

        if (!data.user) {
            return {
                user: null,
                session: null,
                error: {
                    code: 'NO_USER',
                    message: 'Sign in failed',
                },
            };
        }

        // Get profile data
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_tier, github_connected')
            .eq('id', data.user.id)
            .single();

        return {
            user: {
                id: data.user.id,
                email: data.user.email!,
                createdAt: new Date(data.user.created_at),
                subscriptionTier: profile?.subscription_tier || 'free',
                githubConnected: profile?.github_connected || false,
            },
            session: data.session
                ? {
                    accessToken: data.session.access_token,
                    refreshToken: data.session.refresh_token,
                    expiresAt: new Date(data.session.expires_at! * 1000),
                }
                : null,
            error: null,
        };
    }

    /**
     * Sign out the current user
     */
    async signOut(): Promise<void> {
        const supabase = createClient();
        await supabase.auth.signOut();
    }

    /**
     * Get the current authenticated user
     */
    async getCurrentUser(): Promise<User | null> {
        const supabase = createClient();

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            return null;
        }

        // Get profile data
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_tier, github_connected')
            .eq('id', user.id)
            .single();

        return {
            id: user.id,
            email: user.email!,
            createdAt: new Date(user.created_at),
            subscriptionTier: profile?.subscription_tier || 'free',
            githubConnected: profile?.github_connected || false,
        };
    }

    /**
     * Update user profile
     */
    async updateProfile(userId: string, updates: ProfileUpdate): Promise<User> {
        const supabase = createClient();

        // Update auth user if email is being changed
        if (updates.email) {
            const { error } = await supabase.auth.updateUser({
                email: updates.email,
            });

            if (error) {
                throw new Error(`Failed to update email: ${error.message}`);
            }
        }

        // Get current user data
        const { data: user } = await supabase.auth.getUser();

        if (!user.user) {
            throw new Error('User not found');
        }

        // Get profile data
        const { data: profile } = await supabase
            .from('profiles')
            .select('subscription_tier, github_connected')
            .eq('id', userId)
            .single();

        return {
            id: user.user.id,
            email: updates.email || user.user.email!,
            createdAt: new Date(user.user.created_at),
            subscriptionTier: profile?.subscription_tier || 'free',
            githubConnected: profile?.github_connected || false,
        };
    }

    /**
     * Send a password-reset email via Supabase.
     * Supabase handles the token generation and email delivery.
     */
    async resetPassword(email: string): Promise<void> {
        const supabase = createClient();
        const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/auth/callback?next=/app/settings`;

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo,
        });

        if (error) {
            throw new Error(error.message);
        }
    }

    /**
     * Convert technical error messages to user-friendly ones
     */
    private getReadableErrorMessage(message: string): string {
        if (message.includes('Invalid login credentials')) {
            return 'Invalid email or password. Please try again.';
        }
        if (message.includes('Email not confirmed')) {
            return 'Please confirm your email address before signing in.';
        }
        if (message.includes('User already registered')) {
            return 'An account with this email already exists.';
        }
        return message;
    }
}

// Export singleton instance
export const authService = new AuthService();
