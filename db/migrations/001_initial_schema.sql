-- AI Studio - Initial Schema
-- 001_initial_schema.sql

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Trigger function for auto-updating updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- agents table
-- ============================================================================
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'idle' CHECK (status IN ('idle', 'active', 'error', 'stopped')),
    config JSONB DEFAULT '{}',
    metrics JSONB DEFAULT '{}',
    pid INTEGER,
    worktree_path TEXT,
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER agents_update_updated_at
BEFORE UPDATE ON agents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX agents_name ON agents(name);
CREATE INDEX agents_status ON agents(status);

-- ============================================================================
-- prds table
-- ============================================================================
CREATE TABLE prds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'active', 'completed')),
    created_by VARCHAR(100) DEFAULT 'human',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER prds_update_updated_at
BEFORE UPDATE ON prds
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX prds_status ON prds(status);

-- ============================================================================
-- prd_approvals table
-- ============================================================================
CREATE TABLE prd_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prd_id UUID NOT NULL REFERENCES prds(id),
    agent_id UUID NOT NULL REFERENCES agents(id),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'questions', 'overridden')),
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(prd_id, agent_id)
);

CREATE TRIGGER prd_approvals_update_updated_at
BEFORE UPDATE ON prd_approvals
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX prd_approvals_prd_id ON prd_approvals(prd_id);
CREATE INDEX prd_approvals_agent_id ON prd_approvals(agent_id);

-- ============================================================================
-- tasks table
-- ============================================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id VARCHAR(50) UNIQUE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'backlog' CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'qa', 'done', 'blocked')),
    priority VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    assigned_to UUID REFERENCES agents(id),
    created_by UUID REFERENCES agents(id),
    prd_id UUID REFERENCES prds(id),
    branch_name VARCHAR(200),
    pr_url TEXT,
    labels JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tasks_update_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX tasks_status ON tasks(status);
CREATE INDEX tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX tasks_prd_id ON tasks(prd_id);
CREATE INDEX tasks_created_by ON tasks(created_by);

-- ============================================================================
-- messages table
-- ============================================================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent UUID REFERENCES agents(id),
    to_agent UUID REFERENCES agents(id),
    task_id UUID REFERENCES tasks(id),
    type VARCHAR(30) DEFAULT 'message' CHECK (type IN ('message', 'task_update', 'pr_review', 'question', 'approval', 'escalation', 'system')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX messages_to_agent ON messages(to_agent);
CREATE INDEX messages_from_agent ON messages(from_agent);
CREATE INDEX messages_task_id ON messages(task_id);
CREATE INDEX messages_created_at ON messages(created_at);
CREATE INDEX messages_read ON messages(read);

-- ============================================================================
-- knowledge_base table
-- ============================================================================
CREATE TABLE knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path VARCHAR(500) UNIQUE NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    tags JSONB DEFAULT '[]',
    created_by UUID REFERENCES agents(id),
    updated_by UUID REFERENCES agents(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER knowledge_base_update_updated_at
BEFORE UPDATE ON knowledge_base
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX knowledge_base_path ON knowledge_base(path);
CREATE INDEX knowledge_base_tags ON knowledge_base USING GIN(tags);

-- ============================================================================
-- evo_recommendations table
-- ============================================================================
CREATE TABLE evo_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'implemented')),
    priority VARCHAR(10) DEFAULT 'medium',
    principles_referenced JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER evo_recommendations_update_updated_at
BEFORE UPDATE ON evo_recommendations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX evo_recommendations_status ON evo_recommendations(status);
CREATE INDEX evo_recommendations_category ON evo_recommendations(category);
