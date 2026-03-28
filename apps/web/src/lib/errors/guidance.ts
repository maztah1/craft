import type { ErrorDomain, ErrorGuidance } from '@craft/types';

const DOCS_BASE = 'https://docs.craft.app';
const SUPPORT_URL = 'https://craft.app/support';

/**
 * Lookup key: `{domain}:{code}` — e.g. `"github:RATE_LIMITED"`.
 * A bare `{domain}:*` entry acts as a domain-level fallback.
 */
type GuidanceKey = string;

const GUIDANCE_MAP: Record<GuidanceKey, ErrorGuidance> = {
  // ── GitHub ──────────────────────────────────────────────────────────────
  'github:AUTH_FAILED': {
    template: {
      title: 'GitHub authentication failed',
      message: 'CRAFT could not authenticate with GitHub. Your token may be missing or expired.',
      retryable: false,
    },
    steps: [
      'Go to Settings → Integrations and reconnect your GitHub account.',
      'Ensure the token has the `repo` and `admin:org` scopes.',
      'If using a GitHub App, verify the installation is still active.',
    ],
    links: [
      { label: 'GitHub token scopes', url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens' },
      { label: 'CRAFT GitHub integration', url: `${DOCS_BASE}/integrations/github` },
    ],
  },

  'github:RATE_LIMITED': {
    template: {
      title: 'GitHub rate limit reached',
      message: 'Too many requests were sent to GitHub. Please wait {retryAfter} before trying again.',
      retryable: true,
    },
    steps: [
      'Wait for the rate-limit window to reset (shown in the error details).',
      'Avoid triggering multiple deployments in quick succession.',
      'Consider upgrading to a GitHub App installation for higher limits.',
    ],
    links: [
      { label: 'GitHub rate limiting docs', url: 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api' },
    ],
  },

  'github:COLLISION': {
    template: {
      title: 'Repository name already taken',
      message: 'A repository named "{name}" already exists. Choose a different deployment name.',
      retryable: false,
    },
    steps: [
      'Rename your deployment to something unique.',
      'Or delete the conflicting repository in GitHub and retry.',
    ],
    links: [
      { label: 'Managing repositories', url: 'https://docs.github.com/en/repositories/creating-and-managing-repositories' },
    ],
  },

  'github:NETWORK_ERROR': {
    template: {
      title: 'Could not reach GitHub',
      message: 'A network error occurred while contacting GitHub. Check your connection and try again.',
      retryable: true,
    },
    steps: [
      'Verify your internet connection.',
      'Check the GitHub status page for ongoing incidents.',
      'Retry the operation — transient errors usually resolve quickly.',
    ],
    links: [
      { label: 'GitHub status', url: 'https://www.githubstatus.com' },
    ],
  },

  'github:CONFIGURATION_ERROR': {
    template: {
      title: 'GitHub App misconfigured',
      message: 'The GitHub App credentials are invalid or incomplete. Contact your administrator.',
      retryable: false,
    },
    steps: [
      'Confirm `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_INSTALLATION_ID` are set correctly.',
      'Re-generate the private key in the GitHub App settings if needed.',
      'Ensure the App is installed on the target organisation or account.',
    ],
    links: [
      { label: 'CRAFT environment variables', url: `${DOCS_BASE}/configuration/environment-variables` },
      { label: 'GitHub App setup', url: 'https://docs.github.com/en/apps/creating-github-apps' },
    ],
  },

  // ── Vercel ───────────────────────────────────────────────────────────────
  'vercel:AUTH_FAILED': {
    template: {
      title: 'Vercel authentication failed',
      message: 'CRAFT could not authenticate with Vercel. Your API token may be invalid or revoked.',
      retryable: false,
    },
    steps: [
      'Go to your Vercel dashboard → Settings → Tokens and create a new token.',
      'Update the `VERCEL_TOKEN` environment variable with the new token.',
      'Redeploy the CRAFT platform to pick up the change.',
    ],
    links: [
      { label: 'Vercel API tokens', url: 'https://vercel.com/docs/rest-api#authentication' },
      { label: 'CRAFT Vercel integration', url: `${DOCS_BASE}/integrations/vercel` },
    ],
  },

  'vercel:RATE_LIMITED': {
    template: {
      title: 'Vercel rate limit reached',
      message: 'Too many requests were sent to Vercel. Please wait before retrying.',
      retryable: true,
    },
    steps: [
      'Wait a few minutes before triggering another deployment.',
      'Avoid deploying multiple projects simultaneously.',
    ],
    links: [
      { label: 'Vercel rate limits', url: 'https://vercel.com/docs/rest-api/rate-limits' },
    ],
  },

  'vercel:PROJECT_EXISTS': {
    template: {
      title: 'Vercel project already exists',
      message: 'A Vercel project with this name already exists in your account.',
      retryable: false,
    },
    steps: [
      'Rename your deployment to use a unique project name.',
      'Or remove the existing Vercel project and retry.',
    ],
    links: [
      { label: 'Managing Vercel projects', url: 'https://vercel.com/docs/projects/overview' },
    ],
  },

  'vercel:NETWORK_ERROR': {
    template: {
      title: 'Could not reach Vercel',
      message: 'A network error occurred while contacting Vercel. Check your connection and try again.',
      retryable: true,
    },
    steps: [
      'Verify your internet connection.',
      'Check the Vercel status page for ongoing incidents.',
      'Retry the operation.',
    ],
    links: [
      { label: 'Vercel status', url: 'https://www.vercel-status.com' },
    ],
  },

  // ── Stripe ───────────────────────────────────────────────────────────────
  'stripe:CARD_DECLINED': {
    template: {
      title: 'Payment declined',
      message: 'Your card was declined. Please check your payment details and try again.',
      retryable: true,
    },
    steps: [
      'Verify the card number, expiry date, and CVC are correct.',
      'Ensure sufficient funds are available.',
      'Try a different payment method.',
      'Contact your bank if the problem persists.',
    ],
    links: [
      { label: 'CRAFT billing', url: `${DOCS_BASE}/billing` },
      { label: 'Contact support', url: SUPPORT_URL },
    ],
  },

  'stripe:WEBHOOK_SIGNATURE_INVALID': {
    template: {
      title: 'Stripe webhook verification failed',
      message: 'The incoming Stripe webhook could not be verified. Check your webhook secret.',
      retryable: false,
    },
    steps: [
      'Confirm `STRIPE_WEBHOOK_SECRET` matches the secret shown in the Stripe dashboard.',
      'Ensure the raw request body is passed to the signature verification function without modification.',
      'Re-create the webhook endpoint in Stripe if the secret has been rotated.',
    ],
    links: [
      { label: 'Stripe webhook verification', url: 'https://stripe.com/docs/webhooks/signatures' },
      { label: 'CRAFT Stripe setup', url: `${DOCS_BASE}/integrations/stripe` },
    ],
  },

  'stripe:SUBSCRIPTION_NOT_FOUND': {
    template: {
      title: 'Subscription not found',
      message: 'No active subscription was found for your account.',
      retryable: false,
    },
    steps: [
      'Visit the Pricing page to start or renew a subscription.',
      'If you believe this is an error, contact support with your account email.',
    ],
    links: [
      { label: 'CRAFT pricing', url: 'https://craft.app/pricing' },
      { label: 'Contact support', url: SUPPORT_URL },
    ],
  },

  // ── Stellar ──────────────────────────────────────────────────────────────
  'stellar:INSUFFICIENT_BALANCE': {
    template: {
      title: 'Insufficient XLM balance',
      message: 'The account does not have enough XLM to complete this transaction.',
      retryable: false,
    },
    steps: [
      'Fund the account with additional XLM via an exchange or faucet.',
      'On testnet, use the Stellar Friendbot: https://friendbot.stellar.org',
      'Ensure the account maintains the minimum reserve (currently 1 XLM base + 0.5 XLM per entry).',
    ],
    links: [
      { label: 'Stellar minimum balance', url: 'https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance' },
      { label: 'Testnet Friendbot', url: 'https://friendbot.stellar.org' },
    ],
  },

  'stellar:NETWORK_MISMATCH': {
    template: {
      title: 'Stellar network mismatch',
      message: 'The configured network does not match the target account. Check your `STELLAR_NETWORK` setting.',
      retryable: false,
    },
    steps: [
      'Verify `STELLAR_NETWORK` is set to `testnet` or `mainnet` as appropriate.',
      'Ensure the Horizon URL matches the selected network.',
      'Do not mix testnet accounts with mainnet operations.',
    ],
    links: [
      { label: 'CRAFT Stellar configuration', url: `${DOCS_BASE}/configuration/stellar` },
      { label: 'Stellar networks', url: 'https://developers.stellar.org/docs/learn/fundamentals/networks' },
    ],
  },

  'stellar:TRANSACTION_FAILED': {
    template: {
      title: 'Stellar transaction failed',
      message: 'The transaction was rejected by the Stellar network. Result code: {resultCode}.',
      retryable: false,
    },
    steps: [
      'Check the result code against the Stellar documentation.',
      'Verify the transaction fee is sufficient.',
      'Ensure all required trustlines are established.',
      'Retry with an updated sequence number if the account state has changed.',
    ],
    links: [
      { label: 'Stellar transaction result codes', url: 'https://developers.stellar.org/docs/data/horizon/api-reference/errors/result-codes/transactions' },
      { label: 'Stellar status', url: 'https://dashboard.stellar.org' },
    ],
  },

  'stellar:ENDPOINT_UNREACHABLE': {
    template: {
      title: 'Stellar endpoint unreachable',
      message: 'Could not connect to the Horizon or Soroban RPC endpoint.',
      retryable: true,
    },
    steps: [
      'Check that `STELLAR_HORIZON_URL` points to a live endpoint.',
      'Verify network connectivity from your deployment environment.',
      'Check the Stellar network status dashboard.',
    ],
    links: [
      { label: 'Stellar status', url: 'https://dashboard.stellar.org' },
      { label: 'Public Horizon endpoints', url: 'https://developers.stellar.org/docs/data/horizon' },
    ],
  },

  // ── Auth ─────────────────────────────────────────────────────────────────
  'auth:INVALID_CREDENTIALS': {
    template: {
      title: 'Invalid email or password',
      message: 'The email or password you entered is incorrect.',
      retryable: true,
    },
    steps: [
      'Double-check your email address for typos.',
      'Use "Forgot password" to reset your password if needed.',
    ],
    links: [
      { label: 'Reset password', url: '/forgot-password' },
    ],
  },

  'auth:EMAIL_TAKEN': {
    template: {
      title: 'Email already registered',
      message: 'An account with this email address already exists.',
      retryable: false,
    },
    steps: [
      'Sign in with your existing account.',
      'Use "Forgot password" if you cannot remember your password.',
    ],
    links: [
      { label: 'Sign in', url: '/signin' },
    ],
  },

  // ── General fallbacks ────────────────────────────────────────────────────
  'general:UNKNOWN': {
    template: {
      title: 'An unexpected error occurred',
      message: 'Something went wrong. Please try again or contact support if the problem persists.',
      retryable: true,
    },
    steps: [
      'Refresh the page and try again.',
      'Check the CRAFT status page for known incidents.',
      'Contact support if the error continues.',
    ],
    links: [
      { label: 'Contact support', url: SUPPORT_URL },
      { label: 'CRAFT status', url: 'https://status.craft.app' },
    ],
  },
};

/**
 * Look up guidance for a given domain + error code.
 * Falls back to `general:UNKNOWN` when no specific entry exists.
 *
 * @example
 * const guidance = getErrorGuidance('github', 'RATE_LIMITED');
 * console.log(guidance.template.title); // "GitHub rate limit reached"
 */
export function getErrorGuidance(domain: ErrorDomain, code: string): ErrorGuidance {
  return (
    GUIDANCE_MAP[`${domain}:${code}`] ??
    GUIDANCE_MAP[`${domain}:UNKNOWN`] ??
    GUIDANCE_MAP['general:UNKNOWN']
  );
}

/**
 * Fill `{placeholder}` tokens in a template message.
 *
 * @example
 * formatMessage('Wait {retryAfter} seconds.', { retryAfter: '60' })
 * // → "Wait 60 seconds."
 */
export function formatMessage(template: string, values: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}
