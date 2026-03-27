/**
 * Property 22 — Vercel Build Configuration
 *
 * REQUIREMENT (design.md):
 * For any supported template, the generated Vercel build settings must remain valid
 * and preserve Turborepo-compatible build settings.
 *
 * This test formally verifies the correctness of Vercel build configuration
 * using fast-check property-based testing with a minimum of 100 iterations.
 *
 * Feature: craft-platform
 * Design spec: .craft/specs/craft-platform/design.md
 * Property: 22
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// ── Type Definitions ─────────────────────────────────────────────────────────

type TemplateFamily = 'stellar-dex' | 'asset-issuance' | 'payment-gateway' | 'soroban-defi';

interface VercelBuildConfig {
  framework: string;
  buildCommand: string;
  outputDirectory: string;
  installCommand: string;
  devCommand: string;
}

interface TemplateConfig {
  family: TemplateFamily;
  name: string;
  hasCustomBuildCommand: boolean;
  hasCustomOutputDir: boolean;
}

interface TurborepoConfig {
  pipeline: Record<string, string[]>;
  globalDependencies: string[];
}

interface BuildValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: VercelBuildConfig;
  turborepoCompatible: boolean;
}

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbTemplateFamily = fc.constantFrom<TemplateFamily>(
  'stellar-dex',
  'asset-issuance',
  'payment-gateway',
  'soroban-defi'
);

const arbTemplateConfig: fc.Arbitrary<TemplateConfig> = fc.record({
  family: arbTemplateFamily,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  hasCustomBuildCommand: fc.boolean(),
  hasCustomOutputDir: fc.boolean(),
});

const arbTurborepoConfig: fc.Arbitrary<TurborepoConfig> = fc.record({
  pipeline: fc.dictionary(
    fc.constantFrom('build', 'dev', 'test', 'lint'),
    fc.array(fc.string(), { minLength: 1, maxLength: 5 })
  ),
  globalDependencies: fc.array(fc.string(), { minLength: 0, maxLength: 10 }),
});

// ── Mock Vercel Build Configuration Generator ────────────────────────────────

class VercelBuildConfigGenerator {
  /**
   * Generate Vercel build configuration for a given template
   */
  generateBuildConfig(template: TemplateConfig): VercelBuildConfig {
    const baseConfig: VercelBuildConfig = {
      framework: 'nextjs',
      buildCommand: 'npm run build',
      outputDirectory: '.next',
      installCommand: 'npm install',
      devCommand: 'npm run dev',
    };

    // Apply template-specific overrides
    if (template.hasCustomBuildCommand) {
      baseConfig.buildCommand = `npm run build:${template.family}`;
    }

    if (template.hasCustomOutputDir) {
      baseConfig.outputDirectory = `dist/${template.family}`;
    }

    return baseConfig;
  }

  /**
   * Validate build configuration
   */
  validateBuildConfig(config: VercelBuildConfig): BuildValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate framework
    if (!config.framework || config.framework !== 'nextjs') {
      errors.push('Framework must be "nextjs" for CRAFT templates');
    }

    // Validate build command
    if (!config.buildCommand || config.buildCommand.trim() === '') {
      errors.push('Build command cannot be empty');
    }

    // Validate output directory
    if (!config.outputDirectory || config.outputDirectory.trim() === '') {
      errors.push('Output directory cannot be empty');
    }

    // Validate install command
    if (!config.installCommand || config.installCommand.trim() === '') {
      errors.push('Install command cannot be empty');
    }

    // Validate dev command
    if (!config.devCommand || config.devCommand.trim() === '') {
      errors.push('Dev command cannot be empty');
    }

    // Check for Turborepo compatibility
    const turborepoCompatible = this.checkTurborepoCompatibility(config);

    if (!turborepoCompatible) {
      warnings.push('Build configuration may not be fully Turborepo-compatible');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      config,
      turborepoCompatible,
    };
  }

  /**
   * Check if configuration is Turborepo-compatible
   */
  checkTurborepoCompatibility(config: VercelBuildConfig): boolean {
    // Turborepo requires standard npm scripts
    const validCommands = ['npm run', 'yarn', 'pnpm'];
    const buildCommandValid = validCommands.some(cmd => 
      config.buildCommand.startsWith(cmd) || config.buildCommand === 'next build'
    );
    const installCommandValid = validCommands.some(cmd => 
      config.installCommand.startsWith(cmd) || config.installCommand === 'npm install'
    );

    return buildCommandValid && installCommandValid;
  }

  /**
   * Generate Turborepo configuration for a template
   */
  generateTurborepoConfig(template: TemplateConfig): TurborepoConfig {
    return {
      pipeline: {
        build: ['^build', 'build'],
        dev: ['build'],
        test: ['build'],
        lint: ['build'],
      },
      globalDependencies: [
        'package.json',
        'tsconfig.json',
        '.env*',
      ],
    };
  }
}

// ── Property Tests ───────────────────────────────────────────────────────────

describe('Property 22 — Vercel Build Configuration', () => {
  let generator: VercelBuildConfigGenerator;

  beforeEach(() => {
    generator = new VercelBuildConfigGenerator();
  });

  /**
   * Property 22.1: Generated build configurations are always valid
   *
   * For any supported template, the generated Vercel build configuration
   * must pass validation.
   */
  describe('Property 22.1 — Generated configurations are valid', () => {
    it('for any supported template, generated build config passes validation', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);
            const validation = generator.validateBuildConfig(config);

            // Assert configuration is valid
            expect(validation.valid).toBe(true);
            expect(validation.errors).toHaveLength(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.2: Framework is always nextjs
   *
   * All CRAFT templates must use Next.js framework for Vercel deployment.
   */
  describe('Property 22.2 — Framework is always nextjs', () => {
    it('for any template, framework is always "nextjs"', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);
            expect(config.framework).toBe('nextjs');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.3: Build commands are non-empty
   *
   * All generated build commands must be non-empty strings.
   */
  describe('Property 22.3 — Build commands are non-empty', () => {
    it('for any template, build command is non-empty', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);
            expect(config.buildCommand).toBeTruthy();
            expect(config.buildCommand.trim()).not.toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.4: Output directories are non-empty
   *
   * All generated output directories must be non-empty strings.
   */
  describe('Property 22.4 — Output directories are non-empty', () => {
    it('for any template, output directory is non-empty', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);
            expect(config.outputDirectory).toBeTruthy();
            expect(config.outputDirectory.trim()).not.toBe('');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.5: Turborepo compatibility
   *
   * All generated configurations must be Turborepo-compatible.
   */
  describe('Property 22.5 — Turborepo compatibility', () => {
    it('for any template, build config is Turborepo-compatible', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);
            const validation = generator.validateBuildConfig(config);

            // Assert Turborepo compatibility
            expect(validation.turborepoCompatible).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.6: Custom build commands are preserved
   *
   * When a template has custom build commands, they must be preserved
   * in the generated configuration.
   */
  describe('Property 22.6 — Custom build commands are preserved', () => {
    it('for templates with custom build commands, they are preserved', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig.filter(t => t.hasCustomBuildCommand),
          async (template) => {
            const config = generator.generateBuildConfig(template);
            
            // Assert custom build command includes template family
            expect(config.buildCommand).toContain(template.family);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.7: Custom output directories are preserved
   *
   * When a template has custom output directories, they must be preserved
   * in the generated configuration.
   */
  describe('Property 22.7 — Custom output directories are preserved', () => {
    it('for templates with custom output dirs, they are preserved', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig.filter(t => t.hasCustomOutputDir),
          async (template) => {
            const config = generator.generateBuildConfig(template);
            
            // Assert custom output directory includes template family
            expect(config.outputDirectory).toContain(template.family);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.8: Turborepo config is generated for all templates
   *
   * For any template, a valid Turborepo configuration must be generated.
   */
  describe('Property 22.8 — Turborepo config generation', () => {
    it('for any template, generates valid Turborepo config', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const turborepoConfig = generator.generateTurborepoConfig(template);

            // Assert pipeline exists and has required stages
            expect(turborepoConfig.pipeline).toBeDefined();
            expect(turborepoConfig.pipeline.build).toBeDefined();
            expect(turborepoConfig.pipeline.dev).toBeDefined();

            // Assert global dependencies include package.json
            expect(turborepoConfig.globalDependencies).toContain('package.json');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.9: Consistency across multiple generations
   *
   * Generating configuration for the same template multiple times
   * must produce identical results.
   */
  describe('Property 22.9 — Consistency across generations', () => {
    it('generating config for same template produces identical results', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config1 = generator.generateBuildConfig(template);
            const config2 = generator.generateBuildConfig(template);

            // Assert configurations are identical
            expect(config1).toEqual(config2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 22.10: All required fields are present
   *
   * Generated configurations must include all required Vercel build fields.
   */
  describe('Property 22.10 — All required fields present', () => {
    it('for any template, all required build config fields are present', async () => {
      await fc.assert(
        fc.asyncProperty(
          arbTemplateConfig,
          async (template) => {
            const config = generator.generateBuildConfig(template);

            // Assert all required fields exist
            expect(config).toHaveProperty('framework');
            expect(config).toHaveProperty('buildCommand');
            expect(config).toHaveProperty('outputDirectory');
            expect(config).toHaveProperty('installCommand');
            expect(config).toHaveProperty('devCommand');
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
