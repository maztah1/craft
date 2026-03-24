import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export const stripe = new Proxy({} as Stripe, {
    get(target, prop) {
        if (!stripeInstance) {
            const secretKey = process.env.STRIPE_SECRET_KEY;
            if (!secretKey) {
                throw new Error('STRIPE_SECRET_KEY is not set');
            }
            stripeInstance = new Stripe(secretKey, {
                apiVersion: '2026-02-25.clover',
                typescript: true,
            });
        }
        return (stripeInstance as any)[prop];
    },
});
