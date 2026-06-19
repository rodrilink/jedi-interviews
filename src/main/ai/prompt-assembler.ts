/**
 * The pure AI prompt assembler (D-12/D-13).
 *
 * Given a mode, the recent transcript span, and an optional grounding context, it produces the
 * `{ system, userContent }` pair the gateway sends. It is a pure function: no class, no IO, no
 * side effects, idempotent — mirroring the `.utility.ts` discipline (`load-dotenv.utility.ts`).
 *
 * The grounding-context slot is built now but left EMPTY in Phase 5 (D-13): Phase 6 fills the SAME
 * `context` parameter (notes / ticket text / repo snippets / links) with NO signature change at any
 * call site. {@link formatContext} returns `''` for an absent or empty context, so the Phase-5
 * `userContent` is just the labeled transcript span.
 */

import type Anthropic from '@anthropic-ai/sdk';

import type { AiMode } from './ai-gateway.interface';

/**
 * The recent finalized-transcript window both modes read via `transcriptBuffer.recentSince` (D-09).
 * 60s: the ~60s sub-span of the 90s buffer window the research locked. Named so a per-mode split is
 * a one-line change later (the span is already a per-call argument).
 */
export const RECENT_SPAN_MS = 60_000;

/**
 * The answer-mode system prompt (AI-01/D-12).
 *
 * Drafted from D-12's shape (direct, spoken-style, infers the latest question, no preamble/markdown);
 * the `claude-api` skill was unavailable at research time, so this DRAFT wording is tunable post
 * on-machine verify. The shape — not the exact phrasing — is what satisfies D-12.
 */
export const ANSWER_SYSTEM_PROMPT = `You are a real-time meeting assistant for the user during a live conversation.
You are given the last ~60 seconds of the conversation transcript.

Identify the most recent question in the transcript that appears to be directed at the user, and answer THAT question directly. If no clear question is present, answer the most recent point that seems to invite a response from the user.

Reply in a natural, spoken style the user could say aloud — a few short, scannable sentences. Be direct and specific. Do not restate the question. Do not add preamble like "Sure" or "Great question". Do not use markdown headers. If the transcript is ambiguous, give your single best concise answer rather than asking for clarification.`;

/**
 * The talking-points system prompt (AI-02/D-12).
 *
 * Drafted from D-12's shape (3–5 short bullets about the project work being discussed, spoken-style,
 * grounded in what was actually said). Same DRAFT-wording caveat as {@link ANSWER_SYSTEM_PROMPT}.
 */
export const TALKING_POINTS_SYSTEM_PROMPT = `You are a real-time meeting assistant for the user during a live discussion of project work.
You are given the last ~60 seconds of the conversation transcript.

Produce 3 to 5 short talking points the user could raise about the project work being discussed. Each point is one concise line (a sentence or fragment), phrased so the user could say it aloud. Lead with the most relevant point. Be specific to what was actually discussed in the transcript; do not invent details that are not implied. Output only the bullet points, one per line, each prefixed with "- ". No preamble, no headers, no closing summary.`;

/**
 * The code-challenge (vision) system prompt (AI-03/D-06/D-07).
 *
 * Drafted from D-07's shape (solve the coding challenge shown in the screenshot; use the project
 * context + recent transcript only as supporting constraints; lead with a one-line approach, then the
 * code, then a brief complexity note; no preamble). Same DRAFT-wording caveat as
 * {@link ANSWER_SYSTEM_PROMPT}: the `claude-api` skill is consulted at the build-time decision gate to
 * confirm the model id and image block shape — this wording is tunable post on-machine verify.
 */
export const VISION_SYSTEM_PROMPT = `You are helping the user solve a coding challenge shown in a screenshot during a live interview.
Read the problem from the image. Use the provided project context and recent transcript only as supporting context — the interviewer may have stated constraints aloud that are not in the screenshot.

Produce a correct, idiomatic solution the user could speak through and type. Lead with a one-line description of the approach, then the code, then a brief note on time and space complexity. Do not add preamble like "Sure" or "Here is". Do not restate the full problem.`;

/**
 * The structured grounding context injected into the prompt. Phase 6 fills these (CTX-01..04);
 * Phase 5 passes `undefined` or an empty object so {@link formatContext} yields no context block (D-13).
 */
export interface IGroundingContext {
    /** Free-form project notes pasted by the user (Phase 6, CTX-01). */
    notes?: string;
    /** Ticket / story text pasted by the user (Phase 6, CTX-02). */
    ticketText?: string;
    /** Repo snippets pasted by the user (Phase 6, CTX-03). */
    repoSnippets?: string;
    /** Reference links pasted by the user (Phase 6, CTX-04). */
    links?: string[];
}

/** The assembler input: the mode, the recent transcript span, and the (Phase-5-empty) context slot. */
export interface IAssembleInput {
    /** Which mode's system prompt to select (D-12). */
    mode: AiMode;
    /** The recent finalized transcript span from `transcriptBuffer.recentSince(RECENT_SPAN_MS)`. */
    span: string;
    /** EMPTY in Phase 5; the SAME parameter Phase 6 fills with no call-site change (D-13). */
    context?: IGroundingContext;
    /**
     * The optional captured screenshot for the code-challenge vision mode (D-04/D-07). When present,
     * {@link assemblePrompt} selects {@link VISION_SYSTEM_PROMPT} and returns `userContent` as an
     * image-then-text content-block array; when absent, the function is byte-for-byte Phase-5-identical
     * (a plain-string `userContent` for the text modes). Carries RAW base64 (NO `data:` prefix).
     */
    image?: { base64: string; mediaType: string };
}

/** The assembler output: the selected system prompt and the assembled user turn. */
export interface IAssembledPrompt {
    /** The mode's system prompt (D-12; the vision prompt for code-challenge, D-07). */
    system: string;
    /**
     * The user turn. A plain string for the text modes (byte-for-byte Phase-5-identical), OR an
     * Anthropic content-block array `[{ image }, { text }]` for the vision mode (D-04, image first).
     */
    userContent: string | Anthropic.ContentBlockParam[];
}

/**
 * Formats the grounding context into a prompt block, or `''` when it is empty (D-13).
 *
 * In Phase 5 the context is always empty, so this returns `''` and the `userContent` is just the
 * labeled span. Phase 6 will populate the block here with NO change to {@link assemblePrompt}'s
 * signature or any call site.
 *
 * @param context - The optional grounding context.
 * @returns A trailing-newline-terminated context block, or `''` when there is nothing to format.
 */
export function formatContext(context?: IGroundingContext): string {
    if (context === undefined) {
        return '';
    }

    const sections: string[] = [];
    if (context.notes !== undefined && context.notes.length > 0) {
        sections.push(`Notes:\n${context.notes}`);
    }
    if (context.ticketText !== undefined && context.ticketText.length > 0) {
        sections.push(`Ticket:\n${context.ticketText}`);
    }
    if (context.repoSnippets !== undefined && context.repoSnippets.length > 0) {
        sections.push(`Repo snippets:\n${context.repoSnippets}`);
    }
    if (context.links !== undefined && context.links.length > 0) {
        sections.push(`Links:\n${context.links.join('\n')}`);
    }

    if (sections.length === 0) {
        return '';
    }

    return `${sections.join('\n\n')}\n\n`;
}

/**
 * Assembles the `{ system, userContent }` prompt for a given mode + span (+ empty Phase-5 context).
 *
 * Selects the per-mode system prompt (D-12), then builds the user turn as the (empty in Phase 5)
 * context block followed by the labeled transcript span. The context block is appended HERE in
 * Phase 6 with no signature change at the call site (D-13).
 *
 * @param input - The mode, the recent transcript span, and the optional grounding context.
 * @returns The selected system prompt and the assembled user turn.
 */
export function assemblePrompt(input: IAssembleInput): IAssembledPrompt {
    const contextBlock = formatContext(input.context);
    const text = `${contextBlock}Recent transcript (last ~60s):\n${input.span}`;

    // Vision branch (D-04/D-07): an image present selects the vision system prompt and returns an
    // image-then-text content-block array (image BEFORE text, per the Anthropic docs). The text block
    // reuses the EXACT same `contextBlock + transcript span` string the text modes build, so the
    // screenshot solution stays grounded in the active session context + transcript (D-07).
    if (input.image !== undefined) {
        const userContent: Anthropic.ContentBlockParam[] = [
            {
                type: 'image',
                source: { type: 'base64', media_type: input.image.mediaType as 'image/png', data: input.image.base64 },
            },
            { type: 'text', text },
        ];

        return { system: VISION_SYSTEM_PROMPT, userContent };
    }

    // Text modes (answer/talking-points): byte-for-byte Phase-5-identical — a plain-string user turn.
    const system = input.mode === 'answer' ? ANSWER_SYSTEM_PROMPT : TALKING_POINTS_SYSTEM_PROMPT;

    return { system, userContent: text };
}
