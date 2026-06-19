/**
 * The persisted session-context schema (D-09 / CTX-04).
 *
 * The store is ULID-keyed and multi-context-ready by design so a future URL-fetcher (Jira/Azure/
 * GitHub) can populate named contexts without a schema redesign. v1 ships a single-context UI, so
 * the array holds exactly one DTO in practice; the multi-context capability is schema-only (D-09).
 *
 * The four grounding fields ({@link ISessionContextDto.notes} / {@link ISessionContextDto.ticketText}
 * / {@link ISessionContextDto.repoSnippets} / {@link ISessionContextDto.links}) map directly INTO the
 * existing `IGroundingContext` shape (prompt-assembler.ts) — the repository's `activeAsGrounding()`
 * returns ONLY those four, never the id/metadata.
 */

/**
 * A single session context: a ULID primary key, the four grounding fields the prompt is built from,
 * and optional future-fetcher metadata (CTX-04 seam — populated only when a fetcher creates a context).
 */
export interface ISessionContextDto {
    /** ULID primary key (CTX-04). Generated on first save; stable across updates. */
    id: string;
    /** Free-form project notes pasted by the user (CTX-01). */
    notes?: string;
    /** Ticket / story text pasted by the user (CTX-02). */
    ticketText?: string;
    /** Repo snippets pasted by the user (CTX-03). */
    repoSnippets?: string;
    /** Reference links pasted by the user (CTX-01); one URL per entry. */
    links?: string[];
    /** Optional human-readable name for the context (future-fetcher metadata, CTX-04 seam). */
    name?: string;
    /** Origin of the context: manual paste (v1) or a future fetcher (CTX-04 seam). */
    source?: 'manual' | 'jira' | 'azure' | 'github';
    /** ISO-8601 creation timestamp (future-fetcher metadata, CTX-04 seam). */
    createdAt?: string;
}

/**
 * The electron-store root shape: the multi-context array plus the active context's ULID id.
 *
 * `activeId` is `''` when no context exists yet; the repository's mapping fails safe to `undefined`
 * in that case so the Phase-5 prompt is preserved exactly.
 */
export interface ISessionContextStore {
    /** All persisted contexts (v1 holds one; multi-context is schema-only, D-09). */
    contexts: ISessionContextDto[];
    /** The ULID id of the active context, or `''` when none exists. */
    activeId: string;
}
