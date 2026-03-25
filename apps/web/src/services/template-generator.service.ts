/**
 * TemplateGeneratorService
 *
 * Top-level orchestration layer for template code generation.
 * Accepts a GenerationRequest, validates it, resolves the template family
 * from Supabase via TemplateService, delegates file generation to
 * CodeGeneratorService, and returns a GenerationResultWithMetadata that
 * downstream deployment services can consume without re-querying the database.
 *
 * Feature: template-generator-entrypoint
 * Issue branch: issue-061-implement-template-generator-entrypoint
 * Updated: issue-062-implement-template-cloning-logic
 */

import { validateCustomizationConfig } from '@/lib/customization/validate';
import { templateService, TemplateService } from './template.service';
import {
  CodeGeneratorService,
  TemplateFamilyId,
  codeGeneratorService,
} from './code-generator.service';
import {
  TemplateCloningService,
  templateCloningService,
  type CloneRequest,
} from './template-cloning.service';
import type { TemplateCategory } from '@craft/types';

// ── Re-exports from @craft/types ──────────────────────────────────────────────

export type {
  GenerationRequest,
  GenerationResult,
  GenerationError,
  GeneratedFile,
} from '@craft/types';

// ── ArtifactMetadata ──────────────────────────────────────────────────────────

export interface ArtifactMetadata {
  /** Echoed from the original GenerationRequest. */
  templateId: string;
  /** Resolved from the template's category field. */
  templateFamily: TemplateFamilyId;
  /** ISO 8601 timestamp of when generation completed. */
  generatedAt: string;
  /** Number of files in generatedFiles — always equals generatedFiles.length. */
  fileCount: number;
  /** Echoed from the original GenerationRequest. */
  outputPath: string;
}

// ── GenerationResultWithMetadata ──────────────────────────────────────────────

export type GenerationResultWithMetadata = import('@craft/types').GenerationResult & {
  /** Present only when success is true. */
  artifactMetadata?: ArtifactMetadata;
};

// ── Category → TemplateFamilyId mapping ──────────────────────────────────────

const CATEGORY_TO_FAMILY: Record<TemplateCategory, TemplateFamilyId> = {
  dex: 'stellar-dex',
  lending: 'soroban-defi',
  payment: 'payment-gateway',
  'asset-issuance': 'asset-issuance',
};

/**
 * Maps a TemplateCategory to its corresponding TemplateFamilyId.
 * Pure function — deterministic and exhaustive over all four categories.
 */
export function mapCategoryToFamily(category: TemplateCategory): TemplateFamilyId {
  const family = CATEGORY_TO_FAMILY[category];
  if (!family) {
    throw new Error(`Unknown template category: ${category}`);
  }
  return family;
}

// ── TemplateGeneratorService ──────────────────────────────────────────────────

export class TemplateGeneratorService {
  constructor(
    private readonly _templateService: Pick<TemplateService, 'getTemplate'> = templateService,
    private readonly _codeGeneratorService: Pick<CodeGeneratorService, 'generate'> = codeGeneratorService,
    private readonly _cloningService: Pick<TemplateCloningService, 'clone'> = templateCloningService
  ) {}

  /**
   * Orchestrate a full generation run.
   *
   * Steps:
   *   1. Validate templateId and customization payload
   *   2. Load template from TemplateService
   *   3. Map template category to TemplateFamilyId
   *   4. Delegate to CodeGeneratorService
   *   5. Assemble and return ArtifactMetadata on success
   *
   * Never throws — all error paths return a resolved Promise<GenerationResultWithMetadata>.
   */
  async generate(request: unknown): Promise<GenerationResultWithMetadata> {
    try {
      // ── Step 1: Validate request shape ──────────────────────────────────────
      const req = request as { templateId?: unknown; customization?: unknown; outputPath?: unknown };

      const templateId = typeof req?.templateId === 'string' ? req.templateId.trim() : '';
      if (!templateId) {
        return {
          success: false,
          generatedFiles: [],
          errors: [{ file: 'templateId', message: 'templateId is required', severity: 'error' }],
        };
      }

      const outputPath = typeof req?.outputPath === 'string' ? req.outputPath : '';

      // ── Step 2: Validate customization payload ───────────────────────────────
      const validation = validateCustomizationConfig(req?.customization);
      if (!validation.valid) {
        return {
          success: false,
          generatedFiles: [],
          errors: validation.errors.map((e) => ({
            file: e.field,
            message: e.message,
            severity: 'error' as const,
          })),
        };
      }

      const customization = req.customization as import('@craft/types').CustomizationConfig;

      // ── Step 3: Load template ────────────────────────────────────────────────
      let template: import('@craft/types').Template;
      try {
        template = await this._templateService.getTemplate(templateId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          generatedFiles: [],
          errors: [
            {
              file: 'templateId',
              message: `Failed to load template "${templateId}": ${msg}`,
              severity: 'error',
            },
          ],
        };
      }

      if (!template) {
        return {
          success: false,
          generatedFiles: [],
          errors: [
            {
              file: 'templateId',
              message: `Template not found: ${templateId}`,
              severity: 'error',
            },
          ],
        };
      }

      // ── Step 4: Resolve template family ─────────────────────────────────────
      let templateFamily: TemplateFamilyId;
      try {
        templateFamily = mapCategoryToFamily(template.category);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          generatedFiles: [],
          errors: [
            {
              file: 'templateId',
              message: `Cannot resolve template family for "${templateId}": ${msg}`,
              severity: 'error',
            },
          ],
        };
      }

      // ── Step 5: Clone template into workspace ────────────────────────────────
      const runId = crypto.randomUUID();
      const cloneRequest: CloneRequest = {
        source: { type: 'local', path: template.baseRepositoryUrl },
        workspaceRoot: outputPath || '/tmp/craft-workspaces',
        runId,
      };

      const cloneResult = await this._cloningService.clone(cloneRequest);
      if (!cloneResult.success) {
        return {
          success: false,
          generatedFiles: [],
          errors: cloneResult.errors.map((e) => ({
            file: e.path,
            message: e.message,
            severity: 'error' as const,
          })),
        };
      }

      const workspacePath = cloneResult.workspacePath ?? outputPath;

      // ── Step 6: Generate code ────────────────────────────────────────────────
      const innerResult = this._codeGeneratorService.generate({
        templateId,
        customization,
        outputPath: workspacePath,
        templateFamily,
      });

      if (!innerResult.success) {
        return {
          success: false,
          generatedFiles: innerResult.generatedFiles,
          errors: innerResult.errors,
        };
      }

      // ── Step 7: Assemble artifact metadata ───────────────────────────────────
      const artifactMetadata: ArtifactMetadata = {
        templateId,
        templateFamily,
        generatedAt: new Date().toISOString(),
        fileCount: innerResult.generatedFiles.length,
        outputPath: workspacePath,
      };

      return {
        success: true,
        generatedFiles: innerResult.generatedFiles,
        errors: [],
        artifactMetadata,
      };
    } catch (err: unknown) {
      // Top-level safety net — never throws to caller
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        generatedFiles: [],
        errors: [{ file: 'unknown', message: msg, severity: 'error' }],
      };
    }
  }
}

export const templateGeneratorService = new TemplateGeneratorService();
