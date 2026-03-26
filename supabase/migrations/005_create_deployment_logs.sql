-- Migration 005: deployment_logs table for #112 persistence
-- Structured logs: stage, level, message, metadata
-- RLS: deployment owner read-only (join deployments.user_id)

-- Table
CREATE TABLE IF NOT EXISTS deployment_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deployment_logs_deployment_id_created_at_idx 
ON deployment_logs (deployment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deployment_logs_level_idx ON deployment_logs (level);

-- RLS
ALTER TABLE deployment_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY deployment_logs_select ON deployment_logs 
FOR SELECT USING (
    deployment_id IN (
        SELECT id FROM deployments 
        WHERE user_id = auth.uid()
    )
);

-- Owner-only insert (service runs server-side w/ service key, but RLS for safety)
CREATE POLICY deployment_logs_insert ON deployment_logs 
FOR INSERT WITH CHECK (
    deployment_id IN (
        SELECT id FROM deployments 
        WHERE user_id = auth.uid()
    )
);
