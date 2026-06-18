import Anthropic from '@anthropic-ai/sdk';

/**
 * Maps an arbitrary thrown value from the Anthropic SDK into a short, human-readable reason safe to
 * render inline on the overlay (T-5-02). Pure and side-effect free — it NEVER logs and NEVER returns
 * the raw SDK error payload (which can embed the request body, headers, or `x-api-key`). The
 * orchestrator prefixes the result with `AI error: `, so this returns only the reason fragment.
 *
 * The SDK throws typed `Anthropic.APIError` subclasses carrying an HTTP `status`; we map the common
 * cases to a fixed phrase and fall back to a generic message for everything else rather than echoing
 * `error.message` (which, for a 400, is the entire JSON error body — what produced the wall-of-JSON
 * the overlay used to show).
 *
 * @param error - The value thrown by the SDK stream or a transport fault.
 * @returns A short, safe reason fragment (no `AI error:` prefix, no raw payload).
 */
export function sanitizeAiError(error: unknown): string {
    // Branch on the HTTP status of the base APIError rather than `instanceof` on each subclass: the
    // SDK exposes the subclasses (BadRequestError, etc.) as static members on the value but not as
    // named TYPE exports, so `instanceof Anthropic.BadRequestError` fails to typecheck. `status` +
    // `type` are the documented, stable fields (see the claude-api error reference) and never carry
    // the raw payload.
    if (error instanceof Anthropic.APIError) {
        const status: number | undefined = typeof error.status === 'number' ? error.status : undefined;
        const rawMessage: string = typeof error.message === 'string' ? error.message : '';

        switch (status) {
            case 401:
                return 'authentication failed — check your API key';
            case 403:
                return 'access denied for this model';
            case 429:
                return 'rate limited — try again shortly';
            case 400:
                // A 400 with a billing message is the most common operator-facing case (credit balance
                // too low). Surface a short, actionable phrase rather than the raw JSON body.
                if (rawMessage.toLowerCase().includes('credit balance')) {
                    return 'credit balance too low — add credits in Plans & Billing';
                }

                return 'invalid request';
            default:
                // Any other API-status error (5xx, overloaded, etc.): report the status only, never the body.
                return status !== undefined ? `Anthropic API error (${status})` : 'Anthropic API error';
        }
    }

    // Non-SDK fault (network, abort-adjacent, unexpected): a fixed generic phrase, never the payload.
    return 'request failed';
}
