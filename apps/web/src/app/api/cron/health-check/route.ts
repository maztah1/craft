import { NextRequest, NextResponse } from 'next/server';
import { healthMonitorService } from '@/services/health-monitor.service';

/**
 * Cron endpoint to check health of all deployments
 * This should be called periodically (e.g., every 5 minutes) by a cron service
 *
 * Vercel Cron: https://vercel.com/docs/cron-jobs
 * Configure in vercel.json with crons array containing path and schedule.
 */
export async function GET(req: NextRequest) {
    try {
        // Verify cron secret to prevent unauthorized access
        const authHeader = req.headers.get('authorization');
        const cronSecret = process.env.CRON_SECRET;

        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('Running health check for all deployments...');

        const results = await healthMonitorService.checkAllDeployments();

        const unhealthyCount = results.filter((r) => !r.isHealthy).length;

        console.log(
            `Health check complete: ${results.length} deployments checked, ${unhealthyCount} unhealthy`
        );

        return NextResponse.json({
            success: true,
            totalChecked: results.length,
            unhealthyCount,
            results,
        });
    } catch (error: any) {
        console.error('Error running health check cron:', error);
        return NextResponse.json(
            { error: error.message || 'Health check failed' },
            { status: 500 }
        );
    }
}
