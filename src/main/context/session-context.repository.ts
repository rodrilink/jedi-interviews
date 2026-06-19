import Store from 'electron-store';
import { ulid } from 'ulid';

import type { IGroundingContext } from '../ai/prompt-assembler';
import type { ISessionContextDto, ISessionContextStore } from './session-context.interface';

/**
 * The minimal electron-store surface the repository depends on, over the typed root shape.
 *
 * Declaring it as an interface (rather than depending on the concrete `Store`) is the seam that
 * lets a unit test inject an in-memory fake and run under `environment: 'node'` with NO Electron —
 * the standard pattern for unit-testing a persistence wrapper.
 */
export interface IContextStoreHandle {
    /** Reads the full persisted root shape. */
    get(): ISessionContextStore;
    /** Persists the full root shape (one write per Save). */
    set(value: ISessionContextStore): void;
}

/** The four grounding fields the editor saves — the writable slice of {@link ISessionContextDto}. */
export interface ISaveContextFields {
    /** Free-form project notes (CTX-01). */
    notes?: string;
    /** Ticket / story text (CTX-02). */
    ticketText?: string;
    /** Repo snippets (CTX-03). */
    repoSnippets?: string;
    /** Reference links, one URL per entry (CTX-01). */
    links?: string[];
}

/** The default empty root shape persisted when the store is first created. */
const DEFAULT_STORE: ISessionContextStore = { contexts: [], activeId: '' };

/**
 * Wraps a typed electron-store handle whose schema is read-back-able and active-by-ULID (CTX-02/04).
 *
 * Single source of the saved session context. It maps the active context's four grounding fields
 * INTO the existing `IGroundingContext` shape (`activeAsGrounding()`, D-10) — returning `undefined`
 * when no context exists so the prompt fails safe to Phase-5-identical (formatContext → ''). It
 * also write-and-activates a single context (`saveActive()`, D-06): v1's UI is single-context, so
 * a second save UPDATES the existing DTO rather than appending; the multi-context array is
 * schema-only (D-09).
 *
 * @remarks
 * The IDEXX `@singleton()` decorator is NOT applicable here: the Electron main process has no
 * TSyringe DI container. This service is instantiated exactly once in `index.ts` and treated as a
 * singleton by convention.
 *
 * The store is injectable via the constructor (defaulting to a real `electron-store`) purely as the
 * unit-test seam described on {@link IContextStoreHandle}.
 */
export class SessionContextRepository {
    private readonly store: IContextStoreHandle;

    /**
     * @param store - The backing store handle. Defaults to a real electron-store under `userData`
     *                with the empty root shape as its default; tests pass an in-memory fake.
     */
    public constructor(store?: IContextStoreHandle) {
        this.store = store ?? (new Store<ISessionContextStore>({ defaults: DEFAULT_STORE }) as unknown as IContextStoreHandle);
    }

    /**
     * Maps the active context's four grounding fields into the prompt's {@link IGroundingContext}.
     *
     * Returns ONLY `{ notes, ticketText, repoSnippets, links }` — never the id/name/source/createdAt
     * metadata (D-10). When no active context exists, returns `undefined` so the prompt assembler's
     * {@link formatContext} yields `''` (Phase-5-identical fail-safe).
     *
     * @returns The four-field grounding context, or `undefined` when there is no active context.
     */
    public activeAsGrounding(): IGroundingContext | undefined {
        const active = this.getActive();
        if (active === undefined) {
            return undefined;
        }

        const { notes, ticketText, repoSnippets, links } = active;

        return { notes, ticketText, repoSnippets, links };
    }

    /**
     * Returns the active context DTO (including its ULID id) for the editor to pre-fill, or
     * `undefined` when none is active.
     *
     * @returns The active {@link ISessionContextDto}, or `undefined`.
     */
    public getActive(): ISessionContextDto | undefined {
        const state = this.store.get();

        return state.contexts.find((context) => context.id === state.activeId);
    }

    /**
     * Writes the four grounding fields to the active context and activates it (D-06).
     *
     * If an active context already exists, its four fields are updated in place (one context, not
     * two — v1's single-context UI, D-09). Otherwise a new {@link ISessionContextDto} is created with
     * a fresh `ulid()` id, `source: 'manual'`, and an ISO-8601 `createdAt`, pushed to `contexts`, and
     * set as active. Persists exactly once per call.
     *
     * @param fields - The four grounding fields from the editor.
     */
    public saveActive(fields: ISaveContextFields): void {
        const state = this.store.get();
        const existing = state.contexts.find((context) => context.id === state.activeId);

        if (existing !== undefined) {
            existing.notes = fields.notes;
            existing.ticketText = fields.ticketText;
            existing.repoSnippets = fields.repoSnippets;
            existing.links = fields.links;
            this.store.set(state);

            return;
        }

        const created: ISessionContextDto = {
            id: ulid(),
            notes: fields.notes,
            ticketText: fields.ticketText,
            repoSnippets: fields.repoSnippets,
            links: fields.links,
            source: 'manual',
            createdAt: new Date().toISOString(),
        };

        this.store.set({ contexts: [...state.contexts, created], activeId: created.id });
    }
}
