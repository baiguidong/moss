export function renderAdminConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Moss Auth Center Admin</title>
    <style>
      :root {
        --bg: #f3efe6;
        --panel: rgba(255, 251, 244, 0.96);
        --line: #d7ccbb;
        --ink: #1c1712;
        --muted: #6d6359;
        --accent: #165b52;
        --accent-2: #d48b24;
        --danger: #a2362b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        background:
          radial-gradient(circle at top right, rgba(212, 139, 36, 0.22), transparent 28%),
          radial-gradient(circle at left center, rgba(22, 91, 82, 0.18), transparent 24%),
          linear-gradient(180deg, #faf6ee 0%, var(--bg) 100%);
      }
      main {
        max-width: 1280px;
        margin: 0 auto;
        padding: 28px 18px 80px;
      }
      .hero {
        display: grid;
        gap: 10px;
        padding: 24px;
        border: 1px solid var(--line);
        background: var(--panel);
      }
      .hero h1 { margin: 0; font-size: 34px; }
      .hero p { margin: 0; color: var(--muted); }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
        align-items: center;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
        gap: 16px;
        margin-top: 18px;
      }
      section {
        border: 1px solid var(--line);
        background: var(--panel);
        padding: 18px;
      }
      h2 {
        margin: 0 0 12px;
        font-size: 22px;
      }
      label {
        display: block;
        margin: 10px 0 6px;
        font-size: 14px;
      }
      input, textarea, select {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--line);
        background: #fff;
        color: var(--ink);
        font: inherit;
      }
      textarea { min-height: 90px; }
      button {
        margin-top: 12px;
        padding: 10px 14px;
        border: 0;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font: inherit;
      }
      button.alt {
        background: var(--accent-2);
        color: var(--ink);
      }
      button.warn {
        background: var(--danger);
      }
      pre {
        margin: 12px 0 0;
        padding: 12px;
        overflow: auto;
        font-size: 12px;
        background: #f4eee3;
        border: 1px solid var(--line);
      }
      .stack { display: grid; gap: 10px; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; }
      .row > * { flex: 1 1 200px; }
      .hint { color: var(--muted); font-size: 13px; }
      .hidden { display: none; }
      .badge {
        display: inline-block;
        padding: 4px 8px;
        font-size: 12px;
        border: 1px solid var(--line);
        color: var(--muted);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="hero">
        <div class="toolbar">
          <div>
            <h1>Moss Auth Center</h1>
            <p>Admin login, user lifecycle, password reset, API key issuance, and client token debugging.</p>
          </div>
          <div>
            <span class="badge" id="identityBadge">Not signed in</span>
          </div>
        </div>
        <p class="hint">Engineering flow: create a user with email + password, optionally mint an API key, then the client can exchange either user credentials or that API key for an access token.</p>
      </div>

      <div class="grid">
        <section>
          <h2>Admin Login</h2>
          <div class="row">
            <div>
              <label for="adminEmail">Email</label>
              <input id="adminEmail" placeholder="admin@example.com" />
            </div>
            <div>
              <label for="adminPassword">Password</label>
              <input id="adminPassword" type="password" placeholder="Password" />
            </div>
          </div>
          <button id="passwordLoginBtn">Login With Password</button>
          <label for="bootstrapApiKey">Bootstrap API Key</label>
          <textarea id="bootstrapApiKey" placeholder="Optional fallback for first login"></textarea>
          <button class="alt" id="apiKeyLoginBtn">Login With API Key</button>
          <pre id="loginResult"></pre>
        </section>

        <section>
          <h2>Client Token Test</h2>
          <div class="row">
            <div>
              <label for="clientEmail">User Email</label>
              <input id="clientEmail" placeholder="user@example.com" />
            </div>
            <div>
              <label for="clientPassword">User Password</label>
              <input id="clientPassword" type="password" placeholder="Password" />
            </div>
          </div>
          <button class="alt" id="userTokenBtn">Request User Token</button>
          <label for="clientApiKey">Or API Key</label>
          <textarea id="clientApiKey" placeholder="moss_sk_..."></textarea>
          <button class="alt" id="apiTokenBtn">Request API Key Token</button>
          <pre id="clientTokenResult"></pre>
        </section>

        <section id="userAdminSection" class="hidden">
          <h2>User Management</h2>
          <div class="row">
            <div>
              <label for="userEmail">Email</label>
              <input id="userEmail" placeholder="user@example.com" />
            </div>
            <div>
              <label for="userName">Name</label>
              <input id="userName" placeholder="Jane Doe" />
            </div>
          </div>
          <div class="row">
            <div>
              <label for="userRole">Role</label>
              <select id="userRole">
                <option value="member">member</option>
                <option value="viewer">viewer</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label for="userPassword">Initial Password</label>
              <input id="userPassword" type="password" placeholder="Set an initial password" />
            </div>
          </div>
          <button id="createUserBtn">Create User</button>
          <div class="row">
            <div>
              <label for="resetUserId">Reset Password User ID</label>
              <input id="resetUserId" placeholder="user UUID" />
            </div>
            <div>
              <label for="resetPassword">New Password</label>
              <input id="resetPassword" type="password" placeholder="New password" />
            </div>
          </div>
          <button class="warn" id="resetPasswordBtn">Reset Password</button>
          <pre id="userResult"></pre>
        </section>

        <section id="apiKeyAdminSection" class="hidden">
          <h2>API Key Management</h2>
          <label for="apiUserId">User ID</label>
          <input id="apiUserId" placeholder="user UUID" />
          <div class="row">
            <div>
              <label for="apiKeyName">Key Name</label>
              <input id="apiKeyName" value="default-client-key" />
            </div>
            <div>
              <label for="apiScopes">Scopes</label>
              <input id="apiScopes" value="sessions:create,sessions:attach,sessions:list" />
            </div>
          </div>
          <button id="createKeyBtn">Create Key</button>
          <pre id="keyResult"></pre>
        </section>

        <section id="inventorySection" class="hidden">
          <h2>Directory</h2>
          <div class="stack">
            <div class="row">
              <button class="alt" id="refreshMeBtn">Refresh Current Identity</button>
              <button class="alt" id="refreshUsersBtn">Refresh Users</button>
              <button class="alt" id="refreshKeysBtn">Refresh Keys</button>
            </div>
            <pre id="meResult"></pre>
            <pre id="usersResult"></pre>
            <pre id="keysResult"></pre>
          </div>
        </section>

        <section id="auditSection" class="hidden">
          <h2>Session Audit</h2>
          <div class="stack">
            <div class="row">
              <div>
                <label for="auditUserId">User ID</label>
                <input id="auditUserId" placeholder="user UUID" />
              </div>
              <div>
                <label for="auditSessionId">Session ID</label>
                <input id="auditSessionId" placeholder="session UUID" />
              </div>
            </div>
            <div class="row">
              <button class="alt" id="queryUserSessionsBtn">Query User Sessions</button>
              <button class="alt" id="querySessionContextBtn">Query Session Context</button>
            </div>
            <pre id="userSessionsResult"></pre>
            <pre id="sessionContextResult"></pre>
          </div>
        </section>
      </div>
    </main>

    <script>
      let accessToken = ''
      let currentUser = null

      function print(id, value) {
        document.getElementById(id).textContent =
          typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      }

      function updateSignedInState() {
        const signedIn = Boolean(accessToken)
        document.getElementById('userAdminSection').classList.toggle('hidden', !signedIn)
        document.getElementById('apiKeyAdminSection').classList.toggle('hidden', !signedIn)
        document.getElementById('inventorySection').classList.toggle('hidden', !signedIn)
        document.getElementById('auditSection').classList.toggle('hidden', !signedIn)
        document.getElementById('identityBadge').textContent = signedIn
          ? 'Signed in as ' + ((currentUser && currentUser.email) || 'unknown')
          : 'Not signed in'
      }

      async function request(path, options = {}) {
        const headers = Object.assign(
          { 'content-type': 'application/json' },
          options.headers || {},
        )
        if (accessToken) {
          headers.authorization = 'Bearer ' + accessToken
        }
        const response = await fetch(path, Object.assign({}, options, { headers }))
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error((data && data.error) || response.statusText)
        }
        return data
      }

      async function loginWithPassword(email, password) {
        const result = await request('/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            grant_type: 'password',
            email,
            password,
          }),
        })
        accessToken = result.access_token
        currentUser = result.user || null
        updateSignedInState()
        return result
      }

      async function loginWithApiKey(apiKey) {
        const result = await request('/v1/auth/token', {
          method: 'POST',
          body: JSON.stringify({
            grant_type: 'api_key',
            api_key: apiKey,
          }),
        })
        accessToken = result.access_token
        currentUser = result.user || null
        updateSignedInState()
        return result
      }

      document.getElementById('passwordLoginBtn').onclick = async () => {
        try {
          const result = await loginWithPassword(
            document.getElementById('adminEmail').value.trim(),
            document.getElementById('adminPassword').value,
          )
          print('loginResult', result)
        } catch (error) {
          print('loginResult', String(error))
        }
      }

      document.getElementById('apiKeyLoginBtn').onclick = async () => {
        try {
          const result = await loginWithApiKey(
            document.getElementById('bootstrapApiKey').value.trim(),
          )
          print('loginResult', result)
        } catch (error) {
          print('loginResult', String(error))
        }
      }

      document.getElementById('userTokenBtn').onclick = async () => {
        try {
          const result = await request('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({
              grant_type: 'password',
              email: document.getElementById('clientEmail').value.trim(),
              password: document.getElementById('clientPassword').value,
            }),
          })
          print('clientTokenResult', result)
        } catch (error) {
          print('clientTokenResult', String(error))
        }
      }

      document.getElementById('apiTokenBtn').onclick = async () => {
        try {
          const result = await request('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({
              grant_type: 'api_key',
              api_key: document.getElementById('clientApiKey').value.trim(),
            }),
          })
          print('clientTokenResult', result)
        } catch (error) {
          print('clientTokenResult', String(error))
        }
      }

      document.getElementById('createUserBtn').onclick = async () => {
        try {
          const result = await request('/v1/admin/users', {
            method: 'POST',
            body: JSON.stringify({
              email: document.getElementById('userEmail').value.trim(),
              name: document.getElementById('userName').value.trim(),
              role: document.getElementById('userRole').value,
              password: document.getElementById('userPassword').value,
            }),
          })
          print('userResult', result)
        } catch (error) {
          print('userResult', String(error))
        }
      }

      document.getElementById('resetPasswordBtn').onclick = async () => {
        try {
          const userId = document.getElementById('resetUserId').value.trim()
          const result = await request('/v1/admin/users/' + encodeURIComponent(userId) + '/reset-password', {
            method: 'POST',
            body: JSON.stringify({
              password: document.getElementById('resetPassword').value,
            }),
          })
          print('userResult', result)
        } catch (error) {
          print('userResult', String(error))
        }
      }

      document.getElementById('createKeyBtn').onclick = async () => {
        try {
          const scopes = document.getElementById('apiScopes').value
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
          const result = await request('/v1/admin/api-keys', {
            method: 'POST',
            body: JSON.stringify({
              user_id: document.getElementById('apiUserId').value.trim(),
              name: document.getElementById('apiKeyName').value.trim(),
              scopes,
            }),
          })
          print('keyResult', result)
        } catch (error) {
          print('keyResult', String(error))
        }
      }

      document.getElementById('refreshMeBtn').onclick = async () => {
        try {
          const result = await request('/v1/auth/me')
          currentUser = result.user || currentUser
          updateSignedInState()
          print('meResult', result)
        } catch (error) {
          print('meResult', String(error))
        }
      }

      document.getElementById('refreshUsersBtn').onclick = async () => {
        try {
          print('usersResult', await request('/v1/admin/users'))
        } catch (error) {
          print('usersResult', String(error))
        }
      }

      document.getElementById('refreshKeysBtn').onclick = async () => {
        try {
          print('keysResult', await request('/v1/admin/api-keys'))
        } catch (error) {
          print('keysResult', String(error))
        }
      }

      document.getElementById('queryUserSessionsBtn').onclick = async () => {
        try {
          const userId = document.getElementById('auditUserId').value.trim()
          print(
            'userSessionsResult',
            await request('/v1/admin/users/' + encodeURIComponent(userId) + '/sessions'),
          )
        } catch (error) {
          print('userSessionsResult', String(error))
        }
      }

      document.getElementById('querySessionContextBtn').onclick = async () => {
        try {
          const sessionId = document.getElementById('auditSessionId').value.trim()
          print(
            'sessionContextResult',
            await request('/v1/admin/sessions/' + encodeURIComponent(sessionId) + '/context'),
          )
        } catch (error) {
          print('sessionContextResult', String(error))
        }
      }

      updateSignedInState()
    </script>
  </body>
</html>`
}
