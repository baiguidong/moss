// Initial SQLite schema for fresh databases. No legacy conversion.
export const sqliteSchema: string[] = [
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    parent_id TEXT REFERENCES departments(id),
    name TEXT NOT NULL,
    token_limit INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department_id TEXT REFERENCES departments(id),
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    password_hash TEXT,
    password_updated_at INTEGER,
    last_login_at INTEGER,
    token_limit INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    system_key TEXT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (org_id, name),
    UNIQUE (org_id, system_key)
  )`,
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    PRIMARY KEY (role_id, permission)
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, role_id)
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_identities (
    provider_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    api_key_id TEXT REFERENCES api_keys(id),
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL,
    PRIMARY KEY (provider_id, subject),
    UNIQUE (provider_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
    id TEXT PRIMARY KEY,
    redirect_uri TEXT NOT NULL,
    state TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    password_attempts INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code TEXT PRIMARY KEY,
    redirect_uri TEXT NOT NULL,
    state TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    org_id TEXT NOT NULL REFERENCES organizations(id),
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS server_config (
    \`key\` TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS departments_org_idx ON departments (org_id)`,
  `CREATE INDEX IF NOT EXISTS departments_parent_idx ON departments (parent_id)`,
  `CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id)`,
  `CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)`,
  `CREATE INDEX IF NOT EXISTS roles_org_idx ON roles (org_id)`,
  `CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role_id)`,
  `CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (org_id)`,
  `CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_identities_user_idx ON oauth_identities (user_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_authorization_requests_expiry_idx
  ON oauth_authorization_requests (expires_at)`,
  `CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expiry_idx
  ON oauth_authorization_codes (expires_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    transcript_session_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    scopes_json TEXT NOT NULL,
    cwd TEXT NOT NULL,
    docker_image TEXT,
    profile_dir TEXT NOT NULL,
    workspace_dir TEXT,
    transcript_dir TEXT NOT NULL,
    container_name TEXT,
    status TEXT NOT NULL,
    desired_state TEXT NOT NULL,
    current_attempt_id TEXT,
    transcript_path TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    assistant_name TEXT,
    advanced_settings_json TEXT NOT NULL DEFAULT '{}',
    auto_memory_json TEXT NOT NULL DEFAULT '{}',
    session_memory_json TEXT NOT NULL DEFAULT '{}',
    runtime_options_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL,
    ended_at INTEGER,
    deleted_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS session_attempts (
    attempt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    generation INTEGER NOT NULL,
    runtime_state TEXT NOT NULL,
    server_instance_id TEXT,
    runner_pid INTEGER,
    container_name TEXT,
    attempt_dir TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    attach_path TEXT,
    resume_transcript_session_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_heartbeat_at INTEGER,
    stopped_at INTEGER,
    exit_code INTEGER,
    exit_signal TEXT,
    stop_reason TEXT,
    error_text TEXT,
    UNIQUE (session_id, generation)
  )`,
  `CREATE TABLE IF NOT EXISTS server_instances (
    instance_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    pid INTEGER,
    started_at INTEGER NOT NULL,
    heartbeat_at INTEGER NOT NULL,
    stopped_at INTEGER,
    status TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS session_events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    attempt_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx
  ON sessions (org_id, user_id, last_active_at DESC)`,
  `CREATE INDEX IF NOT EXISTS sessions_state_idx
  ON sessions (org_id, status, last_active_at DESC)`,
  `CREATE INDEX IF NOT EXISTS attempts_session_idx
  ON session_attempts (session_id, generation DESC)`,
  `CREATE TABLE IF NOT EXISTS agent_mail_messages (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    from_user_id TEXT NOT NULL REFERENCES users(id),
    to_user_id TEXT NOT NULL REFERENCES users(id),
    client_message_id TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    reply_to TEXT REFERENCES agent_mail_messages(id),
    hop_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('queued','leased','accepted','running','completed','failed','expired')),
    consumer_id TEXT,
    lease_token_hash TEXT,
    lease_until INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    accepted_at INTEGER,
    completed_at INTEGER,
    UNIQUE(from_user_id, client_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_mail_messages_recipient_idx
  ON agent_mail_messages (org_id, to_user_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS agent_mail_messages_sender_idx
  ON agent_mail_messages (org_id, from_user_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS agent_mail_messages_thread_idx
  ON agent_mail_messages (org_id, thread_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS agent_mail_deletions (
    message_id TEXT NOT NULL REFERENCES agent_mail_messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS agent_mail_deletions_user_idx
  ON agent_mail_deletions (user_id, deleted_at)`,
  `CREATE TABLE IF NOT EXISTS agent_mail_consumers (
    org_id TEXT NOT NULL REFERENCES organizations(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    consumer_id TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_mail_acl (
    org_id TEXT NOT NULL REFERENCES organizations(id),
    owner_user_id TEXT NOT NULL REFERENCES users(id),
    sender_user_id TEXT NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL CHECK (mode IN ('blocked','manual','auto')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (org_id, owner_user_id, sender_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS openim_bindings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    openim_user_id TEXT NOT NULL,
    profile_hash TEXT NOT NULL DEFAULT '',
    provisioned_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (instance_id, user_id),
    UNIQUE (instance_id, openim_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS openim_bindings_org_idx
  ON openim_bindings (org_id, instance_id)`,
  `CREATE TABLE IF NOT EXISTS openim_group_bindings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    openim_group_id TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (instance_id, openim_group_id)
  )`,
  `CREATE INDEX IF NOT EXISTS openim_group_bindings_org_idx
  ON openim_group_bindings (org_id, instance_id)`,
  `CREATE TABLE IF NOT EXISTS ragflow_bindings (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    instance_id TEXT NOT NULL,
    ragflow_username TEXT NOT NULL,
    ragflow_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (instance_id, user_id),
    UNIQUE (instance_id, ragflow_username)
  )`,
  `CREATE TABLE IF NOT EXISTS ragflow_audit_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ragflow_bindings_org_idx
  ON ragflow_bindings (org_id, instance_id)`,
  `CREATE INDEX IF NOT EXISTS ragflow_audit_org_idx
  ON ragflow_audit_events (org_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS cloud_settings (\`key\` TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cloud_files (
    id TEXT PRIMARY KEY, orgId TEXT NOT NULL, ownerUserId TEXT NOT NULL, parentId TEXT NOT NULL,
    name TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, revision TEXT NOT NULL,
    objectKey TEXT NOT NULL, state TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS cloud_names ON cloud_files(orgId,ownerUserId,parentId,name) WHERE state IN ('ready','pending')`,
  `CREATE INDEX IF NOT EXISTS cloud_children ON cloud_files(orgId,ownerUserId,parentId,state,id)`,
  `CREATE TABLE IF NOT EXISTS cloud_uploads (
    id TEXT PRIMARY KEY, orgId TEXT NOT NULL, ownerUserId TEXT NOT NULL, fileId TEXT NOT NULL,
    requestKey TEXT NOT NULL, signature TEXT NOT NULL, size INTEGER NOT NULL, partSize INTEGER NOT NULL,
    s3Id TEXT, state TEXT NOT NULL, expiresAt INTEGER NOT NULL,
    UNIQUE(orgId,ownerUserId,requestKey)
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_parts (
    uploadId TEXT NOT NULL, number INTEGER NOT NULL, size INTEGER NOT NULL, etag TEXT NOT NULL,
    PRIMARY KEY(uploadId,number)
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_multipart_cleanup (uploadId TEXT PRIMARY KEY, dueAt INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS users_department_idx ON users (department_id)`,
  `CREATE INDEX IF NOT EXISTS oauth_authorization_codes_state_idx ON oauth_authorization_codes (state)`,
]
