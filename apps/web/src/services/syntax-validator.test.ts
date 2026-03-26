import { describe, it, expect } from 'vitest';
import { SyntaxValidator } from './syntax-validator';

const validator = new SyntaxValidator();

describe('SyntaxValidator.validate — routing', () => {
    it('routes .ts files to validateTypeScript', () => {
        const result = validator.validate({ path: 'src/lib/config.ts', content: 'export const x = 1;', type: 'code' });
        expect(result.valid).toBe(true);
    });

    it('routes .json files to validateJSON', () => {
        const result = validator.validate({ path: 'package.json', content: '{"name":"test"}', type: 'config' });
        expect(result.valid).toBe(true);
    });

    it('returns valid:true for other extensions (.env, .css, etc.)', () => {
        const result = validator.validate({ path: '.env.local', content: 'NEXT_PUBLIC_FOO=bar', type: 'config' });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('enforces errors-valid invariant: errors is empty when valid is true', () => {
        const result = validator.validate({ path: 'src/lib/config.ts', content: 'export const x = 1;', type: 'code' });
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('enforces errors-valid invariant: errors is non-empty when valid is false', () => {
        const result = validator.validate({ path: 'src/lib/config.ts', content: 'export const x = {', type: 'code' });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });
});

describe('SyntaxValidator.validateTypeScript', () => {
    it('returns valid:true for a valid TypeScript snippet', () => {
        const result = validator.validateTypeScript('test.ts', `
            export const config = {
                appName: 'My App',
                network: 'mainnet',
            };
        `);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('returns valid:false for an unclosed brace', () => {
        const result = validator.validateTypeScript('test.ts', `
            export const config = {
                appName: 'My App',
        `);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns valid:false for a broken string literal', () => {
        const result = validator.validateTypeScript('test.ts', `export const x = '
broken';`);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('includes file path and message in error entries', () => {
        const result = validator.validateTypeScript('my-file.ts', 'export const x = {');
        expect(result.valid).toBe(false);
        expect(result.errors[0].file).toBe('my-file.ts');
        expect(result.errors[0].message.length).toBeGreaterThan(0);
    });
});

describe('SyntaxValidator.validateJSON', () => {
    it('returns valid:true for valid JSON', () => {
        const result = validator.validateJSON('package.json', '{"name":"test","version":"1.0.0"}');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('returns valid:false for JSON with unquoted key', () => {
        const result = validator.validateJSON('package.json', '{name:"test"}');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns valid:false for truncated JSON', () => {
        const result = validator.validateJSON('package.json', '{"name":');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('includes file path and message in error entries', () => {
        const result = validator.validateJSON('my-file.json', '{bad json}');
        expect(result.valid).toBe(false);
        expect(result.errors[0].file).toBe('my-file.json');
        expect(result.errors[0].message.length).toBeGreaterThan(0);
    });
});
