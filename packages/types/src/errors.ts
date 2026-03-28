/** Identifies which external service produced the error. */
export type ErrorDomain = 'github' | 'vercel' | 'stripe' | 'stellar' | 'auth' | 'general';

/**
 * A reusable error message template.
 * Placeholders use `{key}` syntax and are replaced at call-site.
 */
export interface ErrorTemplate {
  /** Short, user-facing title. */
  title: string;
  /** Longer explanation. May contain `{placeholder}` tokens. */
  message: string;
  /** Whether the caller can meaningfully retry the operation. */
  retryable: boolean;
}

/** Step-by-step remediation guidance attached to an error code. */
export interface ErrorGuidance {
  template: ErrorTemplate;
  /** Ordered list of remediation steps shown to the user. */
  steps: string[];
  /** Links to relevant documentation or support resources. */
  links: Array<{ label: string; url: string }>;
}
