import { describe, it, expect } from 'vitest';
import { FaultInjector, type FaultType } from './fault-injector';
import type { GeneratedFile } from '@craft/types';

const injector = new FaultInjector();

const tsFile: GeneratedFile = {
    path: 'src/lib/config.ts',
    content: `import { foo } from 'bar';
export const config = {
    appName: 'My App',
    network: 'mainnet',
};
export default config;
`,
    type: 'code',
};

const jsonFile: GeneratedFile = {
    path: 'package.json',
    content: '{"name":"test","version":"1.0.0","dependencies":{}}',
    type: 'config',
};

describe('FaultInjector — immutability', () => {
    const faultTypes: FaultType[] = [
        'unclosed_brace', 'broken_string', 'invalid_json_key',
        'truncated_json', 'duplicate_export', 'missing_semicolon_ts',
    ];

    for (const fault of faultTypes) {
        it(`inject('${fault}') returns a new object reference`, () => {
            const file = fault === 'invalid_json_key' || fault === 'truncated_json' ? jsonFile : tsFile;
            const result = injector.inject(file, fault);
            expect(result).not.toBe(file);
        });

        it(`inject('${fault}') preserves path and type`, () => {
            const file = fault === 'invalid_json_key' || fault === 'truncated_json' ? jsonFile : tsFile;
            const result = injector.inject(file, fault);
            expect(result.path).toBe(file.path);
            expect(result.type).toBe(file.type);
        });
    }
});

describe('FaultInjector — content mutations', () => {
    it('unclosed_brace removes the last } from content', () => {
        const result = injector.inject(tsFile, 'unclosed_brace');
        expect(result.content).not.toBe(tsFile.content);
        // Last } should be gone
        const lastBraceOriginal = tsFile.content.lastIndexOf('}');
        expect(result.content.length).toBe(tsFile.content.length - 1);
        expect(result.content[lastBraceOriginal]).not.toBe('}');
    });

    it('broken_string inserts a newline after the first single-quote', () => {
        const result = injector.inject(tsFile, 'broken_string');
        expect(result.content).not.toBe(tsFile.content);
        expect(result.content.length).toBe(tsFile.content.length + 1);
    });

    it('invalid_json_key removes quotes from the first JSON key', () => {
        const result = injector.inject(jsonFile, 'invalid_json_key');
        expect(result.content).not.toBe(jsonFile.content);
        expect(result.content).toContain('name:');
        expect(result.content).not.toMatch(/^"name":/);
    });

    it('truncated_json truncates content to ~50%', () => {
        const result = injector.inject(jsonFile, 'truncated_json');
        expect(result.content.length).toBe(Math.floor(jsonFile.content.length / 2));
    });

    it('duplicate_export appends a duplicate export declaration', () => {
        const result = injector.inject(tsFile, 'duplicate_export');
        expect(result.content).toContain('\nexport const config = {};');
        expect(result.content.length).toBeGreaterThan(tsFile.content.length);
    });

    it('missing_semicolon_ts removes semicolons from import lines', () => {
        const result = injector.inject(tsFile, 'missing_semicolon_ts');
        expect(result.content).not.toBe(tsFile.content);
        // import line should no longer end with semicolon
        const importLine = result.content.split('\n').find(l => l.startsWith('import'));
        expect(importLine).toBeDefined();
        expect(importLine!.endsWith(';')).toBe(false);
    });
});
