import { describe, expect, it } from 'vitest';

import type { IGroundingContext } from '../ai/prompt-assembler';
import type { ISessionContextStore } from './session-context.interface';
import { type IContextStoreHandle, SessionContextRepository } from './session-context.repository';

/**
 * In-memory stand-in for the electron-store handle the repository wraps, mirroring the
 * fake-dependency style of ai-orchestrator.test.ts. Lets the repository run under
 * `environment: 'node'` with NO Electron — only `get`/`set` over the typed root shape are needed.
 */
class FakeContextStore implements IContextStoreHandle {
    public constructor(private state: ISessionContextStore = { contexts: [], activeId: '' }) {}

    public get(): ISessionContextStore {
        return this.state;
    }

    public set(value: ISessionContextStore): void {
        this.state = value;
    }
}

describe('SessionContextRepository', () => {
    it('should return undefined from activeAsGrounding on an empty store', () => {
        // Arrange
        const repository = new SessionContextRepository(new FakeContextStore());

        // Act
        const grounding: IGroundingContext | undefined = repository.activeAsGrounding();

        // Assert
        expect(grounding).toBeUndefined();
    });

    it('should return ONLY the four grounding fields from activeAsGrounding', () => {
        // Arrange
        const store = new FakeContextStore();
        const repository = new SessionContextRepository(store);
        repository.saveActive({ notes: 'n', ticketText: 't', repoSnippets: 'r', links: ['a', 'b'] });

        // Act
        const grounding: IGroundingContext | undefined = repository.activeAsGrounding();

        // Assert
        expect(grounding).toEqual({ notes: 'n', ticketText: 't', repoSnippets: 'r', links: ['a', 'b'] });
        expect(Object.keys(grounding ?? {}).sort()).toEqual(['links', 'notes', 'repoSnippets', 'ticketText']);
    });

    it('should create one ULID-keyed active context on first saveActive', () => {
        // Arrange
        const store = new FakeContextStore();
        const repository = new SessionContextRepository(store);

        // Act
        repository.saveActive({ notes: 'hello' });

        // Assert
        const persisted: ISessionContextStore = store.get();
        expect(persisted.contexts).toHaveLength(1);
        expect(persisted.contexts[0].id).toBeTruthy();
        expect(persisted.activeId).toBe(persisted.contexts[0].id);
        expect(persisted.contexts[0].notes).toBe('hello');
    });

    it('should UPDATE the existing active context on a second saveActive (one context, not two)', () => {
        // Arrange
        const store = new FakeContextStore();
        const repository = new SessionContextRepository(store);
        repository.saveActive({ notes: 'first' });
        const originalId: string = store.get().contexts[0].id;

        // Act
        repository.saveActive({ notes: 'second' });

        // Assert
        const persisted: ISessionContextStore = store.get();
        expect(persisted.contexts).toHaveLength(1);
        expect(persisted.contexts[0].id).toBe(originalId);
        expect(persisted.contexts[0].notes).toBe('second');
    });

    it('should return the persisted DTO including its ULID id from getActive', () => {
        // Arrange
        const store = new FakeContextStore();
        const repository = new SessionContextRepository(store);
        repository.saveActive({ ticketText: 'JIRA-1' });

        // Act
        const active = repository.getActive();

        // Assert
        expect(active?.id).toBe(store.get().activeId);
        expect(active?.ticketText).toBe('JIRA-1');
        expect(active?.source).toBe('manual');
        expect(active?.createdAt).toBeTruthy();
    });

    it('should read back the persisted active context from a fresh repository instance (CTX-02)', () => {
        // Arrange
        const store = new FakeContextStore();
        new SessionContextRepository(store).saveActive({ notes: 'persisted' });

        // Act
        const reopened = new SessionContextRepository(store);
        const grounding: IGroundingContext | undefined = reopened.activeAsGrounding();

        // Assert
        expect(grounding).toEqual({ notes: 'persisted', ticketText: undefined, repoSnippets: undefined, links: undefined });
    });
});
