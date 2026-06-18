import { describe, expect, it } from 'vitest';
import { parseDotenv } from './load-dotenv.utility';

describe('load-dotenv.utility', () => {
    it('should parse simple KEY=value pairs', () => {
        // Arrange
        const contents = 'DEEPGRAM_API_KEY=abc123\nFOO=bar';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ DEEPGRAM_API_KEY: 'abc123', FOO: 'bar' });
    });

    it('should ignore blank lines and comments', () => {
        // Arrange
        const contents = '# a comment\n\nFOO=bar\n   # indented comment\nBAZ=qux';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    it('should strip surrounding single or double quotes from values', () => {
        // Arrange
        const contents = 'A="quoted"\nB=\'single\'\nC=plain';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ A: 'quoted', B: 'single', C: 'plain' });
    });

    it('should trim surrounding whitespace around key and value', () => {
        // Arrange
        const contents = '  KEY  =  value with spaces  ';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ KEY: 'value with spaces' });
    });

    it('should keep equals signs that appear inside the value', () => {
        // Arrange
        const contents = 'TOKEN=a=b=c';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ TOKEN: 'a=b=c' });
    });

    it('should skip lines with no equals sign', () => {
        // Arrange
        const contents = 'NOT_A_PAIR\nVALID=1';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({ VALID: '1' });
    });

    it('should return an empty object for empty input', () => {
        // Arrange
        const contents = '';

        // Act
        const result: Record<string, string> = parseDotenv(contents);

        // Assert
        expect(result).toEqual({});
    });
});
