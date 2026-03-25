/**
 * Unit tests for TemplateCloningService
 *
 * Feature: template-cloning-logic
 * Issue branch: issue-062-implement-template-cloning-logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as nodePath from 'path';
import {
  TemplateCloningService,
  templateCloningService,
  type FileSystemAdapter,
  type CloningConfig,
  type CloneRequest,
} from './template-cloning.service';

// ── In-memory FileSystemAdapter mock ─────────────────────────────────────────

interface MockFsState {
  dirs: Set<string>;
  files: Map<string, string>; // path → content
  mkdirError?: Error;
  readdirError?: Error;
  copyFileError?: Error;
}

function makeMockFs(state: MockFsState): FileSystemAdapter {
  return {
    async mkdir(path, _options) {
      if (state.mkdirError) throw state.mkdirError;
      state.dirs.add(path);
    },
    async readdir(path, _options) {
      if (state.readdirError) throw state.readdirError;
      const prefix = path.endsWith(nodePath.sep) ? path : path + nodePath.sep;
      return Array.from(state.files.keys())
        .filter((f) => f.startsWith(prefix))
        .map((f) => nodePath.relative(path, f));
    },
    async copyFile(src, dest) {
      if (state.copyFileError) throw state.copyFileError;
      const content = state.files.get(src) ?? '';
      state.files.set(dest, content);
    },
    async exists(path) {
      return state.dirs.has(path) || state.files.has(path);
    },
  };
}

// ── Test config with predictable allowed roots ────────────────────────────────

const ALLOWED_SOURCE = '/allowed/templates';
const ALLOWED_WORKSPACE = '/allowed/workspaces';

const testConfig: CloningConfig = {
  allowedSourceRoots: [ALLOWED_SOURCE],
  allowedWorkspaceRoots: [ALLOWED_WORKSPACE],
};

function makeRequest(overrides: Partial<CloneRequest> = {}): CloneRequest {
  return {
    source: { type: 'local', path: `${ALLOWED_SOURCE}/my-template` },
    workspaceRoot: ALLOWED_WORKSPACE,
    runId: 'run-abc123',
    ...overrides,
  };
}

function makeService(state: MockFsState): TemplateCloningService {
  return new TemplateCloningService(makeMockFs(state), testConfig);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TemplateCloningService', () => {
  describe('singleton export', () => {
    it('templateCloningService is an instance of TemplateCloningService', () => {
      expect(templateCloningService).toBeInstanceOf(TemplateCloningService);
    });
  });

  describe('happy path', () => {
    it('copies files to workspace, returns success:true with absolute normalized workspacePath', async () => {
      const srcBase = `${ALLOWED_SOURCE}/my-template`;
      const state: MockFsState = {
        dirs: new Set(),
        files: new Map([
          [`${srcBase}/src/index.ts`, 'export {}'],
          [`${srcBase}/package.json`, '{}'],
        ]),
      };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(true);
      expect(result.workspacePath).toBeDefined();
      expect(nodePath.isAbsolute(result.workspacePath!)).toBe(true);
      expect(result.workspacePath).not.toMatch(/\/$/);
      expect(result.workspacePath).toBe(`${ALLOWED_WORKSPACE}/run-abc123`);
      expect(result.errors).toHaveLength(0);
    });

    it('creates workspace directory and copies files preserving relative structure', async () => {
      const srcBase = `${ALLOWED_SOURCE}/my-template`;
      const state: MockFsState = {
        dirs: new Set(),
        files: new Map([
          [`${srcBase}/src/lib/config.ts`, 'config'],
          [`${srcBase}/README.md`, '# readme'],
        ]),
      };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(true);
      const ws = result.workspacePath!;
      expect(state.files.has(`${ws}/src/lib/config.ts`)).toBe(true);
      expect(state.files.has(`${ws}/README.md`)).toBe(true);
    });

    it('empty source directory: workspace created, success:true, no files', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('runId validation', () => {
    it('rejects runId containing /', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest({ runId: 'run/evil' }));
      expect(result.success).toBe(false);
      expect(result.errors[0].severity).toBe('error');
      expect(result.workspacePath).toBeUndefined();
    });

    it('rejects runId containing ..', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest({ runId: '../escape' }));
      expect(result.success).toBe(false);
      expect(result.errors[0].severity).toBe('error');
    });

    it('rejects runId containing \\', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest({ runId: 'run\\evil' }));
      expect(result.success).toBe(false);
      expect(result.errors[0].severity).toBe('error');
    });
  });

  describe('path traversal prevention', () => {
    it('rejects source path outside allowed source roots', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(
        makeRequest({ source: { type: 'local', path: '/etc/passwd' } })
      );
      expect(result.success).toBe(false);
      expect(result.errors[0].severity).toBe('error');
      expect(result.workspacePath).toBeUndefined();
    });

    it('rejects workspaceRoot outside allowed workspace roots', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest({ workspaceRoot: '/tmp/evil' }));
      expect(result.success).toBe(false);
      expect(result.errors[0].severity).toBe('error');
    });

    it('skips files that escape source root with warning, continues cloning safe files', async () => {
      const srcBase = `${ALLOWED_SOURCE}/my-template`;
      const state: MockFsState = {
        dirs: new Set(),
        files: new Map([
          [`${srcBase}/safe.ts`, 'safe'],
        ]),
      };
      // Inject a readdir that returns a traversal path alongside a safe one
      const mockFs: FileSystemAdapter = {
        async mkdir(_p, _o) { state.dirs.add(_p); },
        async readdir(_p, _o) {
          return ['safe.ts', '../../../etc/passwd'];
        },
        async copyFile(src, dest) {
          state.files.set(dest, state.files.get(src) ?? '');
        },
        async exists(_p) { return false; },
      };
      const svc = new TemplateCloningService(mockFs, testConfig);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(true);
      expect(result.errors.some((e) => e.severity === 'warning')).toBe(true);
      // Safe file should be copied
      const ws = result.workspacePath!;
      expect(state.files.has(`${ws}/safe.ts`)).toBe(true);
    });
  });

  describe('workspace collision detection', () => {
    it('returns success:false when workspace already exists', async () => {
      const workspacePath = `${ALLOWED_WORKSPACE}/run-abc123`;
      const state: MockFsState = {
        dirs: new Set([workspacePath]),
        files: new Map(),
      };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('collision');
      expect(result.workspacePath).toBeUndefined();
    });

    it('propagates mkdir error message on non-collision failure', async () => {
      const state: MockFsState = {
        dirs: new Set(),
        files: new Map(),
        mkdirError: new Error('disk full'),
      };
      const svc = makeService(state);
      const result = await svc.clone(makeRequest());

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('disk full');
    });
  });

  describe('unknown source type', () => {
    it('returns success:false for unrecognised source type', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      const result = await svc.clone(
        makeRequest({ source: { type: 'git', url: 'https://github.com/x/y' } as any })
      );
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('not supported');
    });
  });

  describe('workspacePath invariants', () => {
    it('workspacePath is undefined on all failure results', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);

      const r1 = await svc.clone(makeRequest({ runId: '../bad' }));
      expect(r1.workspacePath).toBeUndefined();

      const r2 = await svc.clone(makeRequest({ source: { type: 'local', path: '/outside' } }));
      expect(r2.workspacePath).toBeUndefined();
    });

    it('never throws — resolves for null/undefined/invalid input', async () => {
      const state: MockFsState = { dirs: new Set(), files: new Map() };
      const svc = makeService(state);
      await expect(svc.clone(null)).resolves.toBeDefined();
      await expect(svc.clone(undefined)).resolves.toBeDefined();
      await expect(svc.clone(42)).resolves.toBeDefined();
    });
  });
});
