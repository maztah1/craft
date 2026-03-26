/**
 * SyntaxValidator
 *
 * Validates the syntactic correctness of generated TypeScript and JSON files
 * without executing them. Uses the TypeScript compiler API for .ts files and
 * JSON.parse for .json files. All other file types are considered valid by default.
 *
 * Feature: generated-code-syntax-validation-property-test
 */

import * as ts from 'typescript';
import type { GeneratedFile } from '@craft/types';

export interface SyntaxValidationError {
    file: string;
    message: string;
    line?: number;
}

export interface SyntaxValidationResult {
    valid: boolean;
    errors: SyntaxValidationError[];
}

export class SyntaxValidator {
    /**
     * Validate a generated file based on its extension.
     * - .ts  → TypeScript syntactic validation (no type-checking)
     * - .json → JSON.parse validation
     * - other → no-op, always valid
     */
    validate(file: GeneratedFile): SyntaxValidationResult {
        if (file.path.endsWith('.ts')) {
            return this.validateTypeScript(file.path, file.content);
        }
        if (file.path.endsWith('.json')) {
            return this.validateJSON(file.path, file.content);
        }
        return { valid: true, errors: [] };
    }

    /**
     * Validate TypeScript content using the compiler's syntactic diagnostics only.
     * No imports are resolved and no type-checking is performed.
     */
    validateTypeScript(path: string, content: string): SyntaxValidationResult {
        const sourceFile = ts.createSourceFile(
            path,
            content,
            ts.ScriptTarget.Latest,
            /* setParentNodes */ true,
        );

        // Use the public API: create a program-less diagnostic list via the source file
        const syntacticDiags: readonly ts.Diagnostic[] = (() => {
            // ts.createProgram is heavy; instead use the internal diagnostics attached
            // to the source file during parsing (available via the public API below).
            const program = ts.createProgram({
                rootNames: [path],
                options: { noResolve: true, skipLibCheck: true },
                host: {
                    ...ts.createCompilerHost({}),
                    getSourceFile: (fileName) =>
                        fileName === path ? sourceFile : undefined,
                    fileExists: (fileName) => fileName === path,
                    readFile: (fileName) => (fileName === path ? content : undefined),
                },
            });
            return program.getSyntacticDiagnostics(sourceFile);
        })();

        if (syntacticDiags.length === 0) {
            return { valid: true, errors: [] };
        }

        const errors: SyntaxValidationError[] = syntacticDiags.map((diag) => ({
            file: path,
            message:
                typeof diag.messageText === 'string'
                    ? diag.messageText
                    : diag.messageText.messageText,
            line: diag.start,
        }));

        return { valid: false, errors };
    }

    /**
     * Validate JSON content using the native JSON parser.
     */
    validateJSON(path: string, content: string): SyntaxValidationResult {
        try {
            JSON.parse(content);
            return { valid: true, errors: [] };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                valid: false,
                errors: [{ file: path, message }],
            };
        }
    }
}

export const syntaxValidator = new SyntaxValidator();
