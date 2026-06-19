import { describe, expect, it } from 'vitest';
import { parseLinks } from './parse-links.utility';

describe('parseLinks', () => {
    it('should split newline-separated lines into entries', () => {
        // Arrange
        const text = 'a\nb\nc';

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual(['a', 'b', 'c']);
    });

    it('should drop empty and whitespace-only lines', () => {
        // Arrange
        const text = 'a\n\n  \nb';

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual(['a', 'b']);
    });

    it('should handle CRLF line endings', () => {
        // Arrange
        const text = 'a\r\nb';

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual(['a', 'b']);
    });

    it('should trim surrounding whitespace and drop a trailing newline', () => {
        // Arrange
        const text = '  https://x  \n';

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual(['https://x']);
    });

    it('should return an empty array for empty input', () => {
        // Arrange
        const text = '';

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual([]);
    });

    it('should round-trip with links.join newline', () => {
        // Arrange
        const text = ['a', 'b'].join('\n');

        // Act
        const links: string[] = parseLinks(text);

        // Assert
        expect(links).toEqual(['a', 'b']);
    });
});
