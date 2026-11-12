CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    sector TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativo',
    gender TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS movement (
    key TEXT PRIMARY KEY,
    avg TEXT NOT NULL,
    samples TEXT NOT NULL,
    peak_days TEXT NOT NULL,
    total_records INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS schedule (
    week TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT '6x1',
    off_days TEXT NOT NULL DEFAULT '{}',
    suspension_days TEXT NOT NULL DEFAULT '{}',
    generated_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_attempts (
    ip TEXT PRIMARY KEY,
    window_started INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hourly_movement (
    day INTEGER PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    hours TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS shifts (
    week TEXT NOT NULL,
    day INTEGER NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (week, day)
);
