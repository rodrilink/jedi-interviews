import { describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

import { sanitizeAiError } from './sanitize-ai-error.utility';

/**
 * Builds an `Anthropic.APIError` with a given HTTP status and message. The sanitizer branches on
 * `status`, so the concrete subclass is irrelevant — the base class with the right status exercises
 * every branch and avoids the value-vs-type-export mismatch on the subclass names.
 */
function buildApiError(status: number, message: string): Anthropic.APIError {
    return new Anthropic.APIError(status, undefined, message, undefined);
}

describe('sanitize-ai-error.utility', () => {
    it('should map a 400 credit-balance error to a short billing reason without the raw payload', () => {
        // Arrange
        const rawMessage: string = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
        const error: Anthropic.APIError = buildApiError(400, rawMessage);

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('credit balance too low — add credits in Plans & Billing');
    });

    it('should map a 401 to a key-check reason', () => {
        // Arrange
        const error: Anthropic.APIError = buildApiError(401, 'invalid x-api-key');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('authentication failed — check your API key');
    });

    it('should map a 403 to an access-denied reason', () => {
        // Arrange
        const error: Anthropic.APIError = buildApiError(403, 'permission denied');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('access denied for this model');
    });

    it('should map a 429 to a retry reason', () => {
        // Arrange
        const error: Anthropic.APIError = buildApiError(429, 'too many requests');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('rate limited — try again shortly');
    });

    it('should map a non-credit 400 to a generic invalid-request reason without the payload', () => {
        // Arrange
        const error: Anthropic.APIError = buildApiError(400, '400 {"error":{"message":"messages: roles must alternate"}}');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('invalid request');
    });

    it('should report only the status for other API errors, never the body', () => {
        // Arrange
        const error: Anthropic.APIError = buildApiError(529, 'overloaded {"secret":"leak"}');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('Anthropic API error (529)');
    });

    it('should map a plain non-SDK error to a fixed generic reason without echoing its message', () => {
        // Arrange
        const error: Error = new Error('ECONNRESET socket hang up at 10.0.0.1');

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('request failed');
    });

    it('should map a non-Error thrown value to the generic reason', () => {
        // Arrange
        const error: unknown = 'unexpected string throw';

        // Act
        const reason: string = sanitizeAiError(error);

        // Assert
        expect(reason).toBe('request failed');
    });
});
