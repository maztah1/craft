import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

const fakeUser = { id: 'user-1', email: 'user@example.com' };

function post(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeSupabaseQuery(selectResults: any[]) {
  const insert = vi.fn(() => ({
    select: vi
      .fn()
      .mockResolvedValue(selectResults.shift() ?? { data: null, error: null }),
  }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi
        .fn()
        .mockResolvedValue(
          selectResults.shift() ?? { data: null, error: null }
        ),
    })),
  }));
  const update = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }));
  return { insert, select, update };
}

describe('POST /api/deployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('./route');

    const res = await POST(post('http://localhost/api/deployments'), {
      params: {} as any,
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
    const { POST } = await import('./route');
    const req = new NextRequest('http://localhost/api/deployments', {
      method: 'POST',
      body: 'not-json',
    });

    const res = await POST(req, { params: {} as any });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid JSON');
  });

  it('returns 400 for missing templateId', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post('http://localhost/api/deployments', { customizationConfig: {} }),
      { params: {} as any }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    const templatesTable = makeSupabaseQuery([
      { data: null, error: { message: 'not found' } },
    ]);
    mockFrom.mockImplementation((table: string) => {
      expect(table).toBe('templates');
      return templatesTable;
    });

    const { POST } = await import('./route');
    const res = await POST(
      post('http://localhost/api/deployments', { templateId: 'tpl-1' }),
      { params: {} as any }
    );

    expect(res.status).toBe(404);
  });

  it('returns 422 for invalid customization config', async () => {
    const templatesTable = makeSupabaseQuery([
      { data: { id: 'tpl-1', name: 'My Template' }, error: null },
    ]);
    const deploymentsTable = makeSupabaseQuery([]);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'templates') return templatesTable;
      if (table === 'deployments') return deploymentsTable;
      return makeSupabaseQuery([]);
    });

    const invalidConfig = {
      branding: {
        appName: '',
        primaryColor: '#fff',
        secondaryColor: '#fff',
        fontFamily: 'Inter',
      },
      features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: false,
        enableNotifications: false,
      },
      stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
      },
    };

    const { POST } = await import('./route');
    const res = await POST(
      post('http://localhost/api/deployments', {
        templateId: 'tpl-1',
        customizationConfig: invalidConfig,
      }),
      { params: {} as any }
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.details).toBeDefined();
  });

  it('creates deployment and returns 201', async () => {
    const templatesTable = makeSupabaseQuery([
      { data: { id: 'tpl-1', name: 'My Template' }, error: null },
    ]);
    const deploymentsInsertResult = {
      data: {
        id: 'dep-1',
        template_id: 'tpl-1',
        user_id: fakeUser.id,
        name: 'My Template',
        customization_config: {},
        created_at: new Date().toISOString(),
      },
      error: null,
    };
    const deploymentsTable = makeSupabaseQuery([deploymentsInsertResult]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'templates') return templatesTable;
      if (table === 'deployments') return deploymentsTable;
      return makeSupabaseQuery([]);
    });

    const validConfig = {
      branding: {
        appName: 'App',
        primaryColor: '#000000',
        secondaryColor: '#111111',
        fontFamily: 'Inter',
      },
      features: {
        enableCharts: true,
        enableTransactionHistory: true,
        enableAnalytics: false,
        enableNotifications: false,
      },
      stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
      },
    };

    const { POST } = await import('./route');
    const res = await POST(
      post('http://localhost/api/deployments', {
        templateId: 'tpl-1',
        customizationConfig: validConfig,
      }),
      { params: {} as any }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('dep-1');
    expect(body.status).toBe('generating');
  });
});
