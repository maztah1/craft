/**
 * Unit tests for PackageJsonValidator
 * Feature: package-json-validation
 */

import { describe, it, expect } from 'vitest';
import {
    PackageJsonValidator,
    packageJsonValidator,
    type PackageManifest,
} from './package-json-validator.service';

// ── Base valid manifest ───────────────────────────────────────────────────────

const validManifest: PackageManifest = {
    name: 'stellar-dex-app',
    version: '0.1.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: { next: '14.0.4', react: '^18.2.0', 'stellar-sdk': '^11.2.2' },
    devDependencies: { typescript: '^5.3.3' },
};

function withoutField(field: string): PackageManifest {
    const copy = { ...validManifest };
    delete (copy as Record<string, unknown>)[field];
    return copy;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PackageJsonValidator', () => {
    // 1. Valid manifest
    it('returns valid: true and empty errors for a valid manifest', () => {
        const result = packageJsonValidator.validate(validManifest);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    // 2. Each required field missing individually
    describe('required field presence', () => {
        for (const field of ['name', 'version', 'scripts', 'dependencies'] as const) {
            it(`reports a ValidationError with field "${field}" when it is missing`, () => {
                const result = packageJsonValidator.validate(withoutField(field));
                expect(result.valid).toBe(false);
                const fieldError = result.errors.find((e) => e.field === field);
                expect(fieldError).toBeDefined();
                expect(fieldError?.field).toBe(field);
            });
        }
    });

    // 3. Invalid name strings
    describe('package name format', () => {
        const invalidNames = ['', 'MyApp', 'my app'];

        for (const name of invalidNames) {
            it(`rejects name "${name}" with field: "name" error`, () => {
                const manifest = { ...validManifest, name };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const nameError = result.errors.find((e) => e.field === 'name');
                expect(nameError).toBeDefined();
            });
        }

        // 4. Valid scoped name
        it('accepts a valid scoped name "@scope/pkg"', () => {
            const manifest = { ...validManifest, name: '@scope/pkg' };
            const result = packageJsonValidator.validate(manifest);
            const nameError = result.errors.find((e) => e.field === 'name');
            expect(nameError).toBeUndefined();
        });
    });

    // 5. Invalid semver strings
    describe('semver version validation', () => {
        const invalidVersions = ['1.0', 'latest', ''];

        for (const version of invalidVersions) {
            it(`rejects version "${version}" with field: "version" error`, () => {
                const manifest = { ...validManifest, version };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const versionError = result.errors.find((e) => e.field === 'version');
                expect(versionError).toBeDefined();
            });
        }
    });

    // 6. Valid semver ranges in dependencies
    describe('dependency version range acceptance', () => {
        const validRanges = ['^18.2.0', '~5.0.0', '>=1.0.0'];

        for (const range of validRanges) {
            it(`accepts dependency version range "${range}"`, () => {
                const manifest: PackageManifest = {
                    ...validManifest,
                    dependencies: { react: range },
                };
                const result = packageJsonValidator.validate(manifest);
                const depError = result.errors.find((e) => e.field === 'dependencies/react');
                expect(depError).toBeUndefined();
            });
        }
    });

    // 7. Missing scripts individually
    describe('required scripts presence', () => {
        for (const script of ['dev', 'build', 'start', 'lint'] as const) {
            it(`reports field "scripts.${script}" when script "${script}" is missing`, () => {
                const scripts = { ...validManifest.scripts };
                delete scripts[script];
                const manifest = { ...validManifest, scripts };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const scriptError = result.errors.find((e) => e.field === `scripts.${script}`);
                expect(scriptError).toBeDefined();
            });
        }
    });

    // 8. private: false
    it('reports field "private" when private is false', () => {
        const manifest = { ...validManifest, private: false };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const privateError = result.errors.find((e) => e.field === 'private');
        expect(privateError).toBeDefined();
    });

    // 9. private absent
    it('reports field "private" when private is absent', () => {
        const manifest = withoutField('private');
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const privateError = result.errors.find((e) => e.field === 'private');
        expect(privateError).toBeDefined();
    });

    // 10. Duplicate dependency
    it('reports field "dependencies/<name>" for a package in both dependencies and devDependencies', () => {
        const manifest: PackageManifest = {
            ...validManifest,
            dependencies: { react: '^18.2.0', typescript: '^5.3.3' },
            devDependencies: { typescript: '^5.3.3' },
        };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const dupError = result.errors.find((e) => e.field === 'dependencies/typescript');
        expect(dupError).toBeDefined();
    });

    // 11. Non-JSON content in validateFile
    it('returns a parse error with field "content" for non-JSON input in validateFile', () => {
        const file = { path: 'package.json', content: 'not json at all {{{', type: 'json' };
        const result = packageJsonValidator.validateFile(file);
        expect(result.valid).toBe(false);
        const contentError = result.errors.find((e) => e.field === 'content');
        expect(contentError).toBeDefined();
    });

    // 12. Multiple simultaneous failures
    it('reports all failures when multiple rules are violated simultaneously', () => {
        const manifest: PackageManifest = {
            name: 'MyApp',          // invalid name
            version: 'latest',      // invalid version
            private: false,         // invalid private
            scripts: { dev: 'next dev', build: 'next build', start: 'next start' }, // missing lint
            dependencies: { react: '^18.2.0' },
        };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        expect(result.errors.find((e) => e.field === 'name')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'version')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'private')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'scripts.lint')).toBeDefined();
    });

    // 13. format output ends with \n and uses 2-space indentation
    it('format output ends with a newline and uses 2-space indentation', () => {
        const output = packageJsonValidator.format(validManifest);
        expect(output.endsWith('\n')).toBe(true);
        // 2-space indentation: second line should start with exactly 2 spaces
        const lines = output.split('\n');
        const indentedLine = lines.find((l) => l.startsWith('  ') && !l.startsWith('   '));
        expect(indentedLine).toBeDefined();
    });

    // 14. format round-trip
    it('JSON.parse(format(manifest)) deep-equals the original manifest', () => {
        const output = packageJsonValidator.format(validManifest);
        const parsed = JSON.parse(output);
        expect(parsed).toEqual(validManifest);
    });
});
