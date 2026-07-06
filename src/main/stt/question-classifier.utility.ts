/**
 * Pure local question/statement classifier (QA-03).
 *
 * Each committed utterance is tagged Question or Statement by a fast on-device heuristic so the
 * high-value question signal stands out on the Q/A panel — with NO per-utterance AI call (honors
 * the "AI is user-triggered only" constraint). The heuristic is deliberately conservative: a
 * terminal `?` always counts (D-07), a sentence opening with an interrogative/auxiliary word counts
 * even without punctuation, and anything else falls through to `'statement'` — so borderline text
 * defaults to Statement (D-06). A multi-sentence utterance is a Question if ANY of its sentences is
 * (D-08). No NLP dependency is used; sentence splitting is a local regex (RESEARCH Don't-Hand-Roll).
 *
 * Every function is pure and idempotent: no classes, no shared state, no side effects.
 */

import type { UtteranceClassification } from './stt-provider.interface';

/**
 * Interrogative pronouns/adverbs plus the auxiliary and modal verbs that begin a yes/no or
 * inverted question. A sentence starting with one of these reads as a question even when smart
 * formatting did not append a `?`.
 */
const QUESTION_OPENERS = new Set([
    'who',
    'what',
    'when',
    'where',
    'why',
    'how',
    'which',
    'whom',
    'whose',
    'do',
    'does',
    'did',
    'is',
    'are',
    'am',
    'was',
    'were',
    'can',
    'could',
    'would',
    'will',
    'shall',
    'should',
    'have',
    'has',
    'had',
    'may',
    'might',
    'must',
]);

/**
 * Decides whether a single sentence reads as a question.
 *
 * A trimmed sentence ending in `?` is always a question (D-07). Otherwise the first alphabetic word
 * is taken (leading non-letters stripped, lowercased) and matched against {@link QUESTION_OPENERS}.
 *
 * @param sentence - One sentence of utterance text.
 * @returns `true` if the sentence reads as a question, otherwise `false`.
 */
function sentenceIsQuestion(sentence: string): boolean {
    const trimmed = sentence.trim();
    if (trimmed.endsWith('?')) {
        return true;
    }
    const firstWord = trimmed.toLowerCase().replace(/^[^a-z']+/, '').split(/\s+/)[0] ?? '';
    return QUESTION_OPENERS.has(firstWord);
}

/**
 * Classifies a committed utterance as a Question or a Statement (D-06/D-07/D-08).
 *
 * The text is split into sentences on the local boundary regex `/(?<=[.!?])\s+/` (no NLP dependency)
 * and classified as `'question'` if any sentence reads as a question, otherwise `'statement'`.
 * Empty or cue-free text therefore defaults to `'statement'` (D-06).
 *
 * @param text - The finalized utterance text for one speaker turn.
 * @returns `'question'` if any sentence reads as a question, otherwise `'statement'`.
 */
export function classifyUtterance(text: string): UtteranceClassification {
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences.some(sentenceIsQuestion) ? 'question' : 'statement';
}
