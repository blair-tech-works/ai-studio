-- AI Studio - Seed MVP Agents
-- 002_seed_agents.sql

INSERT INTO agents (name, display_name, type, status, config, metrics, created_at, updated_at)
VALUES
    (
        'pm',
        'Product Manager',
        'pm',
        'idle',
        '{"scope": "requirements, planning, roadmap", "tools": ["prd_writer", "task_creator", "agent_orchestrator"], "max_concurrent_tasks": 1}',
        '{"tasks_created": 0, "tasks_completed": 0, "quality_score": 0}',
        NOW(),
        NOW()
    ),
    (
        'backend-dev',
        'Backend Developer',
        'developer',
        'idle',
        '{"scope": "backend implementation, api design, database", "tools": ["git", "compiler", "code_analyzer"], "max_concurrent_tasks": 2}',
        '{"tasks_completed": 0, "code_quality": 0, "test_coverage": 0}',
        NOW(),
        NOW()
    ),
    (
        'frontend-dev',
        'Frontend Developer',
        'developer',
        'idle',
        '{"scope": "ui implementation, frontend testing, accessibility", "tools": ["git", "browser_inspector", "code_analyzer"], "max_concurrent_tasks": 2}',
        '{"tasks_completed": 0, "code_quality": 0, "test_coverage": 0}',
        NOW(),
        NOW()
    ),
    (
        'qa',
        'QA Engineer',
        'qa',
        'idle',
        '{"scope": "testing, quality assurance, bug discovery", "tools": ["test_runner", "bug_tracker", "performance_monitor"], "max_concurrent_tasks": 3}',
        '{"tests_run": 0, "bugs_found": 0, "regression_rate": 0}',
        NOW(),
        NOW()
    ),
    (
        'evo',
        'Evolution Agent',
        'evo',
        'idle',
        '{"scope": "process improvement, system optimization, constitution refinement", "tools": ["process_analyzer", "metrics_collector", "recommendation_engine"], "max_concurrent_tasks": 1}',
        '{"recommendations_made": 0, "improvements_implemented": 0, "process_efficiency": 0}',
        NOW(),
        NOW()
    );
