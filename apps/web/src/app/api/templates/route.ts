import { NextRequest, NextResponse } from 'next/server';
import { templateService } from '@/services/template.service';
import { handlePreflight } from '@/lib/api/cors';
import type { TemplateFilters } from '@craft/types';

export function OPTIONS(req: NextRequest) {
    return handlePreflight(req);
}

export async function GET(req: NextRequest) {
    try {
        const searchParams = req.nextUrl.searchParams;

        const filters: TemplateFilters = {
            category: searchParams.get('category') as any,
            search: searchParams.get('search') || undefined,
            blockchainType: searchParams.get('blockchainType') as any,
        };

        // Remove undefined values
        Object.keys(filters).forEach((key) => {
            if (filters[key as keyof TemplateFilters] === undefined) {
                delete filters[key as keyof TemplateFilters];
            }
        });

        const templates = await templateService.listTemplates(filters);

        return NextResponse.json(templates);
    } catch (error: any) {
        console.error('Error listing templates:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to list templates' },
            { status: 500 }
        );
    }
}
