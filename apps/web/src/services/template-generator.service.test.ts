/**
 * Unit tests for TemplateGeneratorService
 *
 * Feature: template-generator-entrypoint
 * Issue branch: issue-061-implement-template-generator-entrypoint
 * Updated: issue-062-implement-template-cloning-logic (cloning integration)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TemplateGeneratorService,
  mapCategoryToFamily,
  templateGeneratorService,
} from './template-generator.service';
import type { Template, GeneratedFile, GenerationError } from '@craft/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const validCustomization = {
  branding: {
    appName: 'Test DEX',
    primaryColor: '#4f9eff',
    secondaryColor: '#1a1f36',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: true,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'testnet' as const,
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
};

const validRequest = {
  templateId: 'tmpl-001',
  customization: validCustomization,
  outputPath: '/tmp/output',
};

const mockTemplate: Template = {
  id: 'tmpl-001',
  name: 'Stellar DEX',
  description: 'A DEX template',
  category: 'dex',
  blockchainType: 'stellar',
  baseRepositoryUrl: 'https://github.com/example/stellar-dex',
  previewImageUrl: 'https://example.com/preview.png',
  features: [],
  customizationSchema: {} as any,
  isActive: true,
  createdAt: new Date(),
};

const mockGeneratedFiles: GeneratedFile[] = [
  { path: 'src/config.ts', content: 'export const config = {};', type: 'code' },
  { path: '.env', content: 'NETWORK=testnet', type: 'config' },
];

function makeService(
  templateMock?: Partial<{ getTemplate: () => Promise<Template> }>,
  codeGenMock?: Partial<{ generate: () => any }>,
  cloningMock?: Partial<{ clone: () => Promise<any> }>
) {
  const ts = {
    getTemplate: vi.fn().mockResolvedValue(mockTemplate),
    ...templateMock,
  };
  const cgs = {
    generate: vi.fn().mockReturnValue({
      success: true,
      generatedFiles: mockGeneratedFiles,
      errors: [],
    }),
    ...codeGenMock,
  };
  const cs = {
    clone: vi.fn().mockResolvedValue({
      success: true,
      workspacePath: '/tmp/output',
      errors: [],
    }),
    ...cloningMock,
  };
  return new TemplateGeneratorService(ts as any, cgs as any, cs as any);
}

// ── mapCategoryToFamily ───────────────────────────────────────────────────────

describe('mapCategoryToFamily', () => {
  it('maps dex → stellar-dex', () => {
    expect(mapCategoryToFamily('dex')).toBe('stellar-dex');
  });

  it('maps lending → soroban-defi', () => {
    expect(mapCategoryToFamily('lending')).toBe('soroban-defi');
  });

  it('maps payment → payment-gateway', () => {
    expect(mapCategoryToFamily('payment')).toBe('payment-gateway');
  });

  it('maps asset-issuance → asset-issuance', () => {
    expect(mapCategoryToFamily('asset-issuance')).toBe('asset-issuance');
  });

  it('throws for unknown category', () => {
    expect(() => mapCategoryToFamily('unknown' as any)).toThrow('Unknown template category');
  });
});

// ── Singleton export ──────────────────────────────────────────────────────────

describe('singleton export', () => {
  it('templateGeneratorService is an instance of TemplateGeneratorService', () => {
    expect(templateGeneratorService).toBeInstanceOf(TemplateGeneratorService);
  });
});

// ── Error paths ───────────────────────────────────────────────────────────────

describe('TemplateGeneratorService.generate — error paths', () => {
  let service: TemplateGeneratorService;

  beforeEach(() => {
    service = makeService();
  });

  it('returns success:false when templateId is empty string', async () => {
    const result = await service.generate({ ...validRequest, templateId: '' });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('returns success:false when templateId is whitespace only', async () => {
    const result = await service.generate({ ...validRequest, templateId: '   ' });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('templateId');
  });

  it('returns success:false when templateId is missing', async () => {
    const result = await service.generate({ customization: validCustomization, outputPath: '/tmp' });
    expect(result.success).toBe(false);
  });

  it('returns success:false with field errors when customization is invalid', async () => {
    const result = await service.generate({
      ...validRequest,
      customization: {
        ...validCustomization,
        branding: { ...validCustomization.branding, appName: '' },
      },
    });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].severity).toBe('error');
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('returns success:false when customization has invalid hex color', async () => {
    const result = await service.generate({
      ...validRequest,
      customization: {
        ...validCustomization,
        branding: { ...validCustomization.branding, primaryColor: 'not-a-color' },
      },
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.file.includes('primaryColor'))).toBe(true);
  });

  it('returns success:false when TemplateService.getTemplate throws, error includes templateId', async () => {
    const svc = makeService({
      getTemplate: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    });
    const result = await svc.generate(validRequest);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('tmpl-001');
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('returns success:false when CodeGeneratorService returns success:false, errors propagated', async () => {
    const innerErrors: GenerationError[] = [
      { file: 'src/config.ts', message: 'Syntax error', severity: 'error' },
    ];
    const svc = makeService(undefined, {
      generate: vi.fn().mockReturnValue({ success: false, generatedFiles: [], errors: innerErrors }),
    });
    const result = await svc.generate(validRequest);
    expect(result.success).toBe(false);
    expect(result.errors).toEqual(innerErrors);
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('returns success:false when an unexpected exception is thrown, error includes exception message', async () => {
    const svc = makeService({
      getTemplate: vi.fn().mockImplementation(() => {
        throw new Error('Unexpected boom');
      }),
    });
    const result = await svc.generate(validRequest);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Unexpected boom');
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('never throws — resolves even for completely invalid input', async () => {
    await expect(service.generate(null)).resolves.toBeDefined();
    await expect(service.generate(undefined)).resolves.toBeDefined();
    await expect(service.generate(42)).resolves.toBeDefined();
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('TemplateGeneratorService.generate — happy path', () => {
  it('returns success:true with generatedFiles and complete artifactMetadata', async () => {
    const service = makeService();
    const result = await service.generate(validRequest);

    expect(result.success).toBe(true);
    expect(result.generatedFiles).toEqual(mockGeneratedFiles);
    expect(result.errors).toHaveLength(0);

    expect(result.artifactMetadata).toBeDefined();
    expect(result.artifactMetadata!.templateId).toBe('tmpl-001');
    expect(result.artifactMetadata!.templateFamily).toBe('stellar-dex');
    expect(result.artifactMetadata!.outputPath).toBe('/tmp/output');
    expect(result.artifactMetadata!.fileCount).toBe(mockGeneratedFiles.length);
    expect(new Date(result.artifactMetadata!.generatedAt).toString()).not.toBe('Invalid Date');
  });

  it('artifactMetadata.fileCount equals generatedFiles.length', async () => {
    const service = makeService();
    const result = await service.generate(validRequest);
    expect(result.artifactMetadata!.fileCount).toBe(result.generatedFiles.length);
  });

  it('artifactMetadata.generatedAt is a valid ISO 8601 timestamp', async () => {
    const service = makeService();
    const result = await service.generate(validRequest);
    const d = new Date(result.artifactMetadata!.generatedAt);
    expect(d.toString()).not.toBe('Invalid Date');
    expect(result.artifactMetadata!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('passes customization to CodeGeneratorService unmodified', async () => {
    const generateMock = vi.fn().mockReturnValue({
      success: true,
      generatedFiles: mockGeneratedFiles,
      errors: [],
    });
    const service = makeService(undefined, { generate: generateMock });
    await service.generate(validRequest);
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customization: validCustomization })
    );
  });

  it('resolves the correct templateFamily for each category', async () => {
    const categories: Array<[string, string]> = [
      ['dex', 'stellar-dex'],
      ['lending', 'soroban-defi'],
      ['payment', 'payment-gateway'],
      ['asset-issuance', 'asset-issuance'],
    ];

    for (const [category, expectedFamily] of categories) {
      const generateMock = vi.fn().mockReturnValue({
        success: true,
        generatedFiles: [],
        errors: [],
      });
      const svc = makeService(
        { getTemplate: vi.fn().mockResolvedValue({ ...mockTemplate, category }) },
        { generate: generateMock }
      );
      await svc.generate(validRequest);
      expect(generateMock).toHaveBeenCalledWith(
        expect.objectContaining({ templateFamily: expectedFamily })
      );
    }
  });
});

// ── TemplateCloningService integration ───────────────────────────────────────

describe('TemplateGeneratorService — cloning integration', () => {
  it('calls cloningService.clone before codeGeneratorService.generate', async () => {
    const callOrder: string[] = [];
    const cloneMock = vi.fn().mockImplementation(async () => {
      callOrder.push('clone');
      return { success: true, workspacePath: '/tmp/ws/run-1', errors: [] };
    });
    const generateMock = vi.fn().mockImplementation(() => {
      callOrder.push('generate');
      return { success: true, generatedFiles: mockGeneratedFiles, errors: [] };
    });
    const svc = makeService(undefined, { generate: generateMock }, { clone: cloneMock });
    await svc.generate(validRequest);

    expect(cloneMock).toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalled();
    expect(callOrder).toEqual(['clone', 'generate']);
  });

  it('passes workspacePath from clone result as outputPath to codeGeneratorService', async () => {
    const workspacePath = '/tmp/ws/run-abc';
    const generateMock = vi.fn().mockReturnValue({
      success: true,
      generatedFiles: mockGeneratedFiles,
      errors: [],
    });
    const svc = makeService(
      undefined,
      { generate: generateMock },
      { clone: vi.fn().mockResolvedValue({ success: true, workspacePath, errors: [] }) }
    );
    await svc.generate(validRequest);

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ outputPath: workspacePath })
    );
  });

  it('returns success:false and propagates CloneError messages when clone fails', async () => {
    const svc = makeService(
      undefined,
      undefined,
      {
        clone: vi.fn().mockResolvedValue({
          success: false,
          errors: [{ path: 'runId', message: 'runId is invalid', severity: 'error' }],
        }),
      }
    );
    const result = await svc.generate(validRequest);

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('runId is invalid'))).toBe(true);
    expect(result.artifactMetadata).toBeUndefined();
  });

  it('does not call codeGeneratorService when clone fails', async () => {
    const generateMock = vi.fn();
    const svc = makeService(
      undefined,
      { generate: generateMock },
      {
        clone: vi.fn().mockResolvedValue({
          success: false,
          errors: [{ path: 'source', message: 'path traversal', severity: 'error' }],
        }),
      }
    );
    await svc.generate(validRequest);
    expect(generateMock).not.toHaveBeenCalled();
  });
});
