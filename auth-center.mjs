// src/server/authCenter/server.ts
import http from "http";
import { randomUUID as randomUUID2 } from "crypto";

// src/server/serverLog.ts
function createServerLogger() {
  const write = (level, message) => {
    process.stderr.write(`[claude-server:${level}] ${message}
`);
  };
  return {
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    debug: (message) => {
      if (process.env.DEBUG || process.env.CLAUDE_CODE_DEBUG) {
        write("debug", message);
      }
    }
  };
}

// src/server/auth/token.ts
import { createHmac, timingSafeEqual } from "crypto";
function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`;
  return Buffer.from(normalized, "base64");
}
function signHs256(payload, secret) {
  return base64UrlEncode(createHmac("sha256", secret).update(payload).digest());
}
function issueAccessToken(claims, secret, expiresInSec = 60 * 60) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + expiresInSec;
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    ...claims,
    type: "access",
    iat: issuedAt,
    exp: expiresAt
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = signHs256(signingInput, secret);
  return {
    token: `${signingInput}.${signature}`,
    expiresAt
  };
}
function verifyAccessToken(token, secret, expectedIssuer) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts;
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }
  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return null;
  }
  const expectedSignature = signHs256(`${encodedHeader}.${encodedPayload}`, secret);
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.type !== "access" || typeof payload.sub !== "string" || typeof payload.org_id !== "string" || typeof payload.key_id !== "string" || typeof payload.role !== "string" || !Array.isArray(payload.scopes) || typeof payload.exp !== "number" || payload.exp <= now) {
    return null;
  }
  if (expectedIssuer && payload.iss !== expectedIssuer) {
    return null;
  }
  return {
    rawToken: token,
    userId: payload.sub,
    orgId: payload.org_id,
    role: payload.role,
    scopes: payload.scopes,
    keyId: payload.key_id
  };
}
function hasScope(scopes, requiredScope) {
  if (scopes.includes("*") || scopes.includes(requiredScope) || scopes.includes(`${requiredScope.split(":")[0]}:*`)) {
    return true;
  }
  return false;
}

// src/server/authCenter/store.ts
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual as timingSafeEqual2 } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join as join2 } from "path";

// node_modules/lodash-es/_freeGlobal.js
var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
var _freeGlobal_default = freeGlobal;

// node_modules/lodash-es/_root.js
var freeSelf = typeof self == "object" && self && self.Object === Object && self;
var root = _freeGlobal_default || freeSelf || Function("return this")();
var _root_default = root;

// node_modules/lodash-es/_Symbol.js
var Symbol = _root_default.Symbol;
var _Symbol_default = Symbol;

// node_modules/lodash-es/_getRawTag.js
var objectProto = Object.prototype;
var hasOwnProperty = objectProto.hasOwnProperty;
var nativeObjectToString = objectProto.toString;
var symToStringTag = _Symbol_default ? _Symbol_default.toStringTag : undefined;
function getRawTag(value) {
  var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
  try {
    value[symToStringTag] = undefined;
    var unmasked = true;
  } catch (e) {}
  var result = nativeObjectToString.call(value);
  if (unmasked) {
    if (isOwn) {
      value[symToStringTag] = tag;
    } else {
      delete value[symToStringTag];
    }
  }
  return result;
}
var _getRawTag_default = getRawTag;

// node_modules/lodash-es/_objectToString.js
var objectProto2 = Object.prototype;
var nativeObjectToString2 = objectProto2.toString;
function objectToString(value) {
  return nativeObjectToString2.call(value);
}
var _objectToString_default = objectToString;

// node_modules/lodash-es/_baseGetTag.js
var nullTag = "[object Null]";
var undefinedTag = "[object Undefined]";
var symToStringTag2 = _Symbol_default ? _Symbol_default.toStringTag : undefined;
function baseGetTag(value) {
  if (value == null) {
    return value === undefined ? undefinedTag : nullTag;
  }
  return symToStringTag2 && symToStringTag2 in Object(value) ? _getRawTag_default(value) : _objectToString_default(value);
}
var _baseGetTag_default = baseGetTag;

// node_modules/lodash-es/isObject.js
function isObject(value) {
  var type = typeof value;
  return value != null && (type == "object" || type == "function");
}
var isObject_default = isObject;

// node_modules/lodash-es/isFunction.js
var asyncTag = "[object AsyncFunction]";
var funcTag = "[object Function]";
var genTag = "[object GeneratorFunction]";
var proxyTag = "[object Proxy]";
function isFunction(value) {
  if (!isObject_default(value)) {
    return false;
  }
  var tag = _baseGetTag_default(value);
  return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
}
var isFunction_default = isFunction;

// node_modules/lodash-es/_coreJsData.js
var coreJsData = _root_default["__core-js_shared__"];
var _coreJsData_default = coreJsData;

// node_modules/lodash-es/_isMasked.js
var maskSrcKey = function() {
  var uid = /[^.]+$/.exec(_coreJsData_default && _coreJsData_default.keys && _coreJsData_default.keys.IE_PROTO || "");
  return uid ? "Symbol(src)_1." + uid : "";
}();
function isMasked(func) {
  return !!maskSrcKey && maskSrcKey in func;
}
var _isMasked_default = isMasked;

// node_modules/lodash-es/_toSource.js
var funcProto = Function.prototype;
var funcToString = funcProto.toString;
function toSource(func) {
  if (func != null) {
    try {
      return funcToString.call(func);
    } catch (e) {}
    try {
      return func + "";
    } catch (e) {}
  }
  return "";
}
var _toSource_default = toSource;

// node_modules/lodash-es/_baseIsNative.js
var reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
var reIsHostCtor = /^\[object .+?Constructor\]$/;
var funcProto2 = Function.prototype;
var objectProto3 = Object.prototype;
var funcToString2 = funcProto2.toString;
var hasOwnProperty2 = objectProto3.hasOwnProperty;
var reIsNative = RegExp("^" + funcToString2.call(hasOwnProperty2).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$");
function baseIsNative(value) {
  if (!isObject_default(value) || _isMasked_default(value)) {
    return false;
  }
  var pattern = isFunction_default(value) ? reIsNative : reIsHostCtor;
  return pattern.test(_toSource_default(value));
}
var _baseIsNative_default = baseIsNative;

// node_modules/lodash-es/_getValue.js
function getValue(object, key) {
  return object == null ? undefined : object[key];
}
var _getValue_default = getValue;

// node_modules/lodash-es/_getNative.js
function getNative(object, key) {
  var value = _getValue_default(object, key);
  return _baseIsNative_default(value) ? value : undefined;
}
var _getNative_default = getNative;

// node_modules/lodash-es/_nativeCreate.js
var nativeCreate = _getNative_default(Object, "create");
var _nativeCreate_default = nativeCreate;

// node_modules/lodash-es/_hashClear.js
function hashClear() {
  this.__data__ = _nativeCreate_default ? _nativeCreate_default(null) : {};
  this.size = 0;
}
var _hashClear_default = hashClear;

// node_modules/lodash-es/_hashDelete.js
function hashDelete(key) {
  var result = this.has(key) && delete this.__data__[key];
  this.size -= result ? 1 : 0;
  return result;
}
var _hashDelete_default = hashDelete;

// node_modules/lodash-es/_hashGet.js
var HASH_UNDEFINED = "__lodash_hash_undefined__";
var objectProto4 = Object.prototype;
var hasOwnProperty3 = objectProto4.hasOwnProperty;
function hashGet(key) {
  var data = this.__data__;
  if (_nativeCreate_default) {
    var result = data[key];
    return result === HASH_UNDEFINED ? undefined : result;
  }
  return hasOwnProperty3.call(data, key) ? data[key] : undefined;
}
var _hashGet_default = hashGet;

// node_modules/lodash-es/_hashHas.js
var objectProto5 = Object.prototype;
var hasOwnProperty4 = objectProto5.hasOwnProperty;
function hashHas(key) {
  var data = this.__data__;
  return _nativeCreate_default ? data[key] !== undefined : hasOwnProperty4.call(data, key);
}
var _hashHas_default = hashHas;

// node_modules/lodash-es/_hashSet.js
var HASH_UNDEFINED2 = "__lodash_hash_undefined__";
function hashSet(key, value) {
  var data = this.__data__;
  this.size += this.has(key) ? 0 : 1;
  data[key] = _nativeCreate_default && value === undefined ? HASH_UNDEFINED2 : value;
  return this;
}
var _hashSet_default = hashSet;

// node_modules/lodash-es/_Hash.js
function Hash(entries) {
  var index = -1, length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}
Hash.prototype.clear = _hashClear_default;
Hash.prototype["delete"] = _hashDelete_default;
Hash.prototype.get = _hashGet_default;
Hash.prototype.has = _hashHas_default;
Hash.prototype.set = _hashSet_default;
var _Hash_default = Hash;

// node_modules/lodash-es/_listCacheClear.js
function listCacheClear() {
  this.__data__ = [];
  this.size = 0;
}
var _listCacheClear_default = listCacheClear;

// node_modules/lodash-es/eq.js
function eq(value, other) {
  return value === other || value !== value && other !== other;
}
var eq_default = eq;

// node_modules/lodash-es/_assocIndexOf.js
function assocIndexOf(array, key) {
  var length = array.length;
  while (length--) {
    if (eq_default(array[length][0], key)) {
      return length;
    }
  }
  return -1;
}
var _assocIndexOf_default = assocIndexOf;

// node_modules/lodash-es/_listCacheDelete.js
var arrayProto = Array.prototype;
var splice = arrayProto.splice;
function listCacheDelete(key) {
  var data = this.__data__, index = _assocIndexOf_default(data, key);
  if (index < 0) {
    return false;
  }
  var lastIndex = data.length - 1;
  if (index == lastIndex) {
    data.pop();
  } else {
    splice.call(data, index, 1);
  }
  --this.size;
  return true;
}
var _listCacheDelete_default = listCacheDelete;

// node_modules/lodash-es/_listCacheGet.js
function listCacheGet(key) {
  var data = this.__data__, index = _assocIndexOf_default(data, key);
  return index < 0 ? undefined : data[index][1];
}
var _listCacheGet_default = listCacheGet;

// node_modules/lodash-es/_listCacheHas.js
function listCacheHas(key) {
  return _assocIndexOf_default(this.__data__, key) > -1;
}
var _listCacheHas_default = listCacheHas;

// node_modules/lodash-es/_listCacheSet.js
function listCacheSet(key, value) {
  var data = this.__data__, index = _assocIndexOf_default(data, key);
  if (index < 0) {
    ++this.size;
    data.push([key, value]);
  } else {
    data[index][1] = value;
  }
  return this;
}
var _listCacheSet_default = listCacheSet;

// node_modules/lodash-es/_ListCache.js
function ListCache(entries) {
  var index = -1, length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}
ListCache.prototype.clear = _listCacheClear_default;
ListCache.prototype["delete"] = _listCacheDelete_default;
ListCache.prototype.get = _listCacheGet_default;
ListCache.prototype.has = _listCacheHas_default;
ListCache.prototype.set = _listCacheSet_default;
var _ListCache_default = ListCache;

// node_modules/lodash-es/_Map.js
var Map = _getNative_default(_root_default, "Map");
var _Map_default = Map;

// node_modules/lodash-es/_mapCacheClear.js
function mapCacheClear() {
  this.size = 0;
  this.__data__ = {
    hash: new _Hash_default,
    map: new (_Map_default || _ListCache_default),
    string: new _Hash_default
  };
}
var _mapCacheClear_default = mapCacheClear;

// node_modules/lodash-es/_isKeyable.js
function isKeyable(value) {
  var type = typeof value;
  return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
}
var _isKeyable_default = isKeyable;

// node_modules/lodash-es/_getMapData.js
function getMapData(map, key) {
  var data = map.__data__;
  return _isKeyable_default(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
}
var _getMapData_default = getMapData;

// node_modules/lodash-es/_mapCacheDelete.js
function mapCacheDelete(key) {
  var result = _getMapData_default(this, key)["delete"](key);
  this.size -= result ? 1 : 0;
  return result;
}
var _mapCacheDelete_default = mapCacheDelete;

// node_modules/lodash-es/_mapCacheGet.js
function mapCacheGet(key) {
  return _getMapData_default(this, key).get(key);
}
var _mapCacheGet_default = mapCacheGet;

// node_modules/lodash-es/_mapCacheHas.js
function mapCacheHas(key) {
  return _getMapData_default(this, key).has(key);
}
var _mapCacheHas_default = mapCacheHas;

// node_modules/lodash-es/_mapCacheSet.js
function mapCacheSet(key, value) {
  var data = _getMapData_default(this, key), size = data.size;
  data.set(key, value);
  this.size += data.size == size ? 0 : 1;
  return this;
}
var _mapCacheSet_default = mapCacheSet;

// node_modules/lodash-es/_MapCache.js
function MapCache(entries) {
  var index = -1, length = entries == null ? 0 : entries.length;
  this.clear();
  while (++index < length) {
    var entry = entries[index];
    this.set(entry[0], entry[1]);
  }
}
MapCache.prototype.clear = _mapCacheClear_default;
MapCache.prototype["delete"] = _mapCacheDelete_default;
MapCache.prototype.get = _mapCacheGet_default;
MapCache.prototype.has = _mapCacheHas_default;
MapCache.prototype.set = _mapCacheSet_default;
var _MapCache_default = MapCache;

// node_modules/lodash-es/memoize.js
var FUNC_ERROR_TEXT = "Expected a function";
function memoize(func, resolver) {
  if (typeof func != "function" || resolver != null && typeof resolver != "function") {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  var memoized = function() {
    var args = arguments, key = resolver ? resolver.apply(this, args) : args[0], cache = memoized.cache;
    if (cache.has(key)) {
      return cache.get(key);
    }
    var result = func.apply(this, args);
    memoized.cache = cache.set(key, result) || cache;
    return result;
  };
  memoized.cache = new (memoize.Cache || _MapCache_default);
  return memoized;
}
memoize.Cache = _MapCache_default;
var memoize_default = memoize;

// src/utils/envUtils.ts
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
var getClaudeConfigHomeDir = memoize_default(() => {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR.normalize("NFC");
  }
  const mossDir = join(homedir(), ".moss").normalize("NFC");
  const claudeDir = join(homedir(), ".claude").normalize("NFC");
  if (existsSync(mossDir)) {
    return mossDir;
  }
  return claudeDir;
}, () => process.env.CLAUDE_CONFIG_DIR);

// src/server/authCenter/store.ts
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function toPasswordHashRecord(password, salt) {
  const actualSalt = salt ?? randomBytes(16).toString("hex");
  const derived = scryptSync(password, actualSalt, 64).toString("hex");
  return `scrypt$${actualSalt}$${derived}`;
}
function hashPassword(password) {
  return toPasswordHashRecord(password);
}
function verifyPassword(password, passwordHash) {
  if (!passwordHash) {
    return false;
  }
  const match = passwordHash.match(/^scrypt\$([^$]+)\$([0-9a-f]+)$/);
  if (!match) {
    return false;
  }
  const [, salt, expectedHex] = match;
  const actual = Buffer.from(toPasswordHashRecord(password, salt).split("$")[2] || "", "hex");
  const expected = Buffer.from(expectedHex || "", "hex");
  return actual.length === expected.length && timingSafeEqual2(actual, expected);
}
function createTemporaryPassword(length = 20) {
  return randomBytes(length).toString("base64url").slice(0, length);
}
function getDefaultAuthCenterStorePath() {
  return join2(getClaudeConfigHomeDir(), "auth-center", "store.json");
}
function createApiKeyValue(id, secret) {
  return `moss_sk_${id}.${secret}`;
}
function createApiKeyRecord(input) {
  const id = randomUUID();
  const secret = randomBytes(24).toString("base64url");
  const plainTextKey = createApiKeyValue(id, secret);
  return {
    apiKey: {
      id,
      orgId: input.orgId,
      userId: input.userId,
      name: input.name,
      prefix: plainTextKey.slice(0, 16),
      secretHash: sha256(secret),
      scopes: input.scopes,
      status: "active",
      createdAt: Date.now(),
      lastUsedAt: null
    },
    plainTextKey
  };
}
async function writeStore(storePath, store) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}
`, "utf8");
}
async function ensureAuthCenterStore(storePath = getDefaultAuthCenterStorePath()) {
  try {
    const existing = await readAuthCenterStore(storePath);
    return {
      store: existing,
      bootstrap: { created: false }
    };
  } catch {
    const now = Date.now();
    const orgId = randomUUID();
    const adminUserId = randomUUID();
    const bootstrapAdminEmail = "admin@example.com";
    const bootstrapAdminPassword = createTemporaryPassword();
    const { apiKey, plainTextKey } = createApiKeyRecord({
      orgId,
      userId: adminUserId,
      name: "bootstrap-admin",
      scopes: ["*"]
    });
    const store = {
      version: 1,
      issuer: "moss-auth-center",
      jwtSecret: randomBytes(32).toString("base64url"),
      organizations: [
        {
          id: orgId,
          name: "Default Organization",
          createdAt: now
        }
      ],
      users: [
        {
          id: adminUserId,
          orgId,
          email: bootstrapAdminEmail,
          name: "Bootstrap Admin",
          role: "admin",
          status: "active",
          createdAt: now,
          passwordHash: hashPassword(bootstrapAdminPassword),
          passwordUpdatedAt: now,
          lastLoginAt: null
        }
      ],
      apiKeys: [apiKey]
    };
    await writeStore(storePath, store);
    return {
      store,
      bootstrap: {
        created: true,
        bootstrapAdminApiKey: plainTextKey,
        bootstrapAdminEmail,
        bootstrapAdminPassword
      }
    };
  }
}
async function readAuthCenterStore(storePath = getDefaultAuthCenterStorePath()) {
  const raw = await readFile(storePath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.version !== 1 && parsed.version !== 2 || typeof parsed.issuer !== "string" || typeof parsed.jwtSecret !== "string" || !Array.isArray(parsed.organizations) || !Array.isArray(parsed.users) || !Array.isArray(parsed.apiKeys)) {
    throw new Error(`Invalid auth center store: ${storePath}`);
  }
  return {
    version: 2,
    issuer: parsed.issuer,
    jwtSecret: parsed.jwtSecret,
    organizations: parsed.organizations,
    users: parsed.users.map((user) => ({
      ...user,
      passwordHash: user.passwordHash ?? null,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      lastLoginAt: user.lastLoginAt ?? null
    })),
    apiKeys: parsed.apiKeys
  };
}
async function updateAuthCenterStore(mutator, storePath = getDefaultAuthCenterStorePath()) {
  const store = await readAuthCenterStore(storePath);
  const next = mutator(store);
  await writeStore(storePath, next);
  return next;
}
function sanitizeApiKey(apiKey) {
  const { secretHash: _secretHash, ...rest } = apiKey;
  return rest;
}
function sanitizeUser(user) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
function findApiKeyRecord(store, plainTextKey) {
  const match = plainTextKey.match(/^moss_sk_([^\.]+)\.(.+)$/);
  if (!match) {
    return null;
  }
  const [, id, secret] = match;
  const apiKey = store.apiKeys.find((record) => record.id === id);
  if (!apiKey || apiKey.status !== "active") {
    return null;
  }
  return apiKey.secretHash === sha256(secret) ? apiKey : null;
}

// src/server/authCenter/adminConsole.ts
function renderAdminConsoleHtml() {
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

      updateSignedInState()
    </script>
  </body>
</html>`;
}

// src/server/authCenter/server.ts
function defaultScopesForRole(role) {
  if (role === "admin") {
    return ["*"];
  }
  if (role === "viewer") {
    return ["sessions:list", "sessions:attach"];
  }
  return ["sessions:create", "sessions:attach", "sessions:list"];
}
function issueUserAccessToken(input) {
  const issued = issueAccessToken({
    iss: input.issuer,
    sub: input.user.id,
    org_id: input.user.orgId,
    role: input.user.role,
    scopes: input.scopes,
    key_id: input.keyId
  }, input.jwtSecret, input.tokenTtlSec);
  return {
    access_token: issued.token,
    token_type: "Bearer",
    expires_in: issued.expiresAt - Math.floor(Date.now() / 1000),
    user: {
      id: input.user.id,
      email: input.user.email,
      name: input.user.name,
      role: input.user.role
    },
    organization: {
      id: input.user.orgId
    },
    scopes: input.scopes
  };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}
function getBearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
function writeHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html)
  });
  res.end(html);
}
async function startAuthCenterServer(options = {}, logger = createServerLogger()) {
  const storePath = options.storePath ?? getDefaultAuthCenterStorePath();
  const ensured = await ensureAuthCenterStore(storePath);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4401;
  const tokenTtlSec = options.tokenTtlSec ?? 60 * 60;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, {
          ok: true,
          store_path: storePath
        });
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
        writeHtml(res, 200, renderAdminConsoleHtml());
        return;
      }
      if (req.method === "POST" && (url.pathname === "/v1/auth/token" || url.pathname === "/v1/auth/login")) {
        const rawBody = await readBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const store = await readAuthCenterStore(storePath);
        const grantType = typeof body.grant_type === "string" ? body.grant_type.trim() : typeof body.api_key === "string" ? "api_key" : "password";
        if (grantType === "api_key") {
          const apiKeyValue = typeof body.api_key === "string" ? body.api_key.trim() : "";
          if (!apiKeyValue) {
            writeJson(res, 400, { error: "Missing api_key" });
            return;
          }
          const apiKey = findApiKeyRecord(store, apiKeyValue);
          if (!apiKey) {
            writeJson(res, 401, { error: "Invalid API key" });
            return;
          }
          const user = store.users.find((record) => record.id === apiKey.userId && record.status === "active");
          const organization = store.organizations.find((record) => record.id === apiKey.orgId);
          if (!user || !organization) {
            writeJson(res, 401, { error: "API key owner is invalid" });
            return;
          }
          await updateAuthCenterStore((current) => ({
            ...current,
            apiKeys: current.apiKeys.map((record) => record.id === apiKey.id ? { ...record, lastUsedAt: Date.now() } : record)
          }), storePath);
          writeJson(res, 200, issueUserAccessToken({
            issuer: store.issuer,
            jwtSecret: store.jwtSecret,
            tokenTtlSec,
            user,
            scopes: apiKey.scopes,
            keyId: apiKey.id
          }));
          return;
        }
        if (grantType === "password") {
          const email = typeof body.email === "string" ? body.email.trim() : "";
          const password = typeof body.password === "string" ? body.password : "";
          if (!email || !password) {
            writeJson(res, 400, { error: "Missing email or password" });
            return;
          }
          const user = store.users.find((record) => record.email.toLowerCase() === email.toLowerCase() && record.status === "active");
          if (!user || !verifyPassword(password, user.passwordHash)) {
            writeJson(res, 401, { error: "Invalid email or password" });
            return;
          }
          await updateAuthCenterStore((current) => ({
            ...current,
            users: current.users.map((record) => record.id === user.id ? { ...record, lastLoginAt: Date.now() } : record)
          }), storePath);
          const organization = store.organizations.find((record) => record.id === user.orgId);
          writeJson(res, 200, {
            ...issueUserAccessToken({
              issuer: store.issuer,
              jwtSecret: store.jwtSecret,
              tokenTtlSec,
              user,
              scopes: defaultScopesForRole(user.role),
              keyId: "password-login"
            }),
            organization
          });
          return;
        }
        writeJson(res, 400, { error: `Unsupported grant_type: ${grantType}` });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/auth/me") {
        const token = getBearerToken(req);
        if (!token) {
          writeJson(res, 401, { error: "Missing bearer token" });
          return;
        }
        const store = await readAuthCenterStore(storePath);
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer);
        if (!auth) {
          writeJson(res, 401, { error: "Invalid access token" });
          return;
        }
        const user = store.users.find((record) => record.id === auth.userId);
        const organization = store.organizations.find((record) => record.id === auth.orgId);
        writeJson(res, 200, {
          user: user ? sanitizeUser(user) : null,
          organization,
          scopes: auth.scopes,
          role: auth.role,
          key_id: auth.keyId
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/auth/introspect") {
        const rawBody = await readBody(req);
        const body = rawBody ? JSON.parse(rawBody) : {};
        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token) {
          writeJson(res, 400, { error: "Missing token" });
          return;
        }
        const store = await readAuthCenterStore(storePath);
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer);
        if (!auth) {
          writeJson(res, 200, { active: false });
          return;
        }
        writeJson(res, 200, {
          active: true,
          sub: auth.userId,
          org_id: auth.orgId,
          role: auth.role,
          scopes: auth.scopes,
          key_id: auth.keyId
        });
        return;
      }
      if (url.pathname.startsWith("/v1/admin/")) {
        const token = getBearerToken(req);
        if (!token) {
          writeJson(res, 401, { error: "Missing bearer token" });
          return;
        }
        const store = await readAuthCenterStore(storePath);
        const auth = verifyAccessToken(token, store.jwtSecret, store.issuer);
        if (!auth) {
          writeJson(res, 401, { error: "Invalid access token" });
          return;
        }
        const requireScope = (scope) => {
          if (!hasScope(auth.scopes, scope)) {
            writeJson(res, 403, { error: `Missing scope: ${scope}` });
            return false;
          }
          return true;
        };
        if (req.method === "GET" && url.pathname === "/v1/admin/users") {
          if (!requireScope("admin:users"))
            return;
          writeJson(res, 200, {
            users: store.users.filter((user) => user.orgId === auth.orgId).map((user) => sanitizeUser(user))
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/v1/admin/users") {
          if (!requireScope("admin:users"))
            return;
          const rawBody = await readBody(req);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const email = typeof body.email === "string" ? body.email.trim() : "";
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const role = typeof body.role === "string" ? body.role.trim() : "member";
          const password = typeof body.password === "string" ? body.password : "";
          if (!email || !name || !password) {
            writeJson(res, 400, { error: "Missing email, name, or password" });
            return;
          }
          if (store.users.some((user2) => user2.orgId === auth.orgId && user2.email.toLowerCase() === email.toLowerCase())) {
            writeJson(res, 409, { error: "User email already exists" });
            return;
          }
          const user = {
            id: randomUUID2(),
            orgId: auth.orgId,
            email,
            name,
            role,
            status: "active",
            createdAt: Date.now(),
            passwordHash: hashPassword(password),
            passwordUpdatedAt: Date.now(),
            lastLoginAt: null
          };
          await updateAuthCenterStore((current) => ({
            ...current,
            users: [...current.users, user]
          }), storePath);
          writeJson(res, 200, { user: sanitizeUser(user) });
          return;
        }
        const resetPasswordMatch = url.pathname.match(/^\/v1\/admin\/users\/([^/]+)\/reset-password$/);
        if (req.method === "POST" && resetPasswordMatch) {
          if (!requireScope("admin:users"))
            return;
          const userId = resetPasswordMatch[1] || "";
          const rawBody = await readBody(req);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const password = typeof body.password === "string" ? body.password : "";
          if (!password) {
            writeJson(res, 400, { error: "Missing password" });
            return;
          }
          const user = store.users.find((record) => record.id === userId && record.orgId === auth.orgId);
          if (!user) {
            writeJson(res, 404, { error: "Unknown user_id" });
            return;
          }
          await updateAuthCenterStore((current) => ({
            ...current,
            users: current.users.map((record) => record.id === userId ? {
              ...record,
              passwordHash: hashPassword(password),
              passwordUpdatedAt: Date.now()
            } : record)
          }), storePath);
          writeJson(res, 200, { ok: true });
          return;
        }
        if (req.method === "GET" && url.pathname === "/v1/admin/api-keys") {
          if (!requireScope("admin:api_keys"))
            return;
          writeJson(res, 200, {
            api_keys: store.apiKeys.filter((apiKey) => apiKey.orgId === auth.orgId).map((apiKey) => sanitizeApiKey(apiKey))
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/v1/admin/api-keys") {
          if (!requireScope("admin:api_keys"))
            return;
          const rawBody = await readBody(req);
          const body = rawBody ? JSON.parse(rawBody) : {};
          const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const scopes = Array.isArray(body.scopes) ? body.scopes.filter((scope) => typeof scope === "string" && scope.trim()) : [];
          const user = store.users.find((record) => record.id === userId && record.orgId === auth.orgId);
          if (!user) {
            writeJson(res, 404, { error: "Unknown user_id" });
            return;
          }
          if (!name || scopes.length === 0) {
            writeJson(res, 400, { error: "Missing name or scopes" });
            return;
          }
          const created = createApiKeyRecord({
            orgId: auth.orgId,
            userId: user.id,
            name,
            scopes
          });
          await updateAuthCenterStore((current) => ({
            ...current,
            apiKeys: [...current.apiKeys, created.apiKey]
          }), storePath);
          writeJson(res, 200, {
            api_key: sanitizeApiKey(created.apiKey),
            plain_text_key: created.plainTextKey
          });
          return;
        }
      }
      writeJson(res, 404, { error: "Not found" });
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  const ready = new Promise((resolve, reject) => {
    const onError = (error) => {
      logger.error(error.message);
      reject(error);
    };
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : null);
    });
  });
  server.listen(port, host);
  return {
    port: typeof server.address() === "object" && server.address() ? server.address().port : port,
    host,
    storePath,
    bootstrapAdminApiKey: ensured.bootstrap.bootstrapAdminApiKey,
    bootstrapAdminEmail: ensured.bootstrap.bootstrapAdminEmail,
    bootstrapAdminPassword: ensured.bootstrap.bootstrapAdminPassword,
    ready,
    stop() {
      server.close();
    }
  };
}

// src/server/authCenter/authCenterCli.ts
function printHelp() {
  process.stdout.write([
    "Usage: moss-auth-center [options]",
    "",
    "Options:",
    "  --port <number>         HTTP port (default: 4401)",
    "  --host <host>           Bind address (default: 127.0.0.1)",
    "  --store <path>          Auth center JSON store path",
    "  --token-ttl <sec>       Access token TTL in seconds (default: 3600)",
    "  -h, --help              Show this help",
    ""
  ].join(`
`));
}
function parseArgs(argv) {
  const result = {
    port: undefined,
    host: undefined,
    storePath: undefined,
    tokenTtlSec: undefined
  };
  for (let i = 0;i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (arg === "--port") {
      result.port = Number.parseInt(value || "", 10);
      i += 1;
      continue;
    }
    if (arg === "--host") {
      result.host = value || undefined;
      i += 1;
      continue;
    }
    if (arg === "--store") {
      result.storePath = value || undefined;
      i += 1;
      continue;
    }
    if (arg === "--token-ttl") {
      result.tokenTtlSec = Number.parseInt(value || "", 10);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const running = await startAuthCenterServer(options);
  const port = await running.ready ?? options.port ?? 4401;
  process.stderr.write([
    "",
    "Moss auth center started.",
    `HTTP: http://${options.host ?? "127.0.0.1"}:${port}`,
    `Store: ${running.storePath}`,
    running.bootstrapAdminEmail ? `Bootstrap admin email: ${running.bootstrapAdminEmail}` : "Bootstrap admin email: (existing store, unchanged)",
    running.bootstrapAdminPassword ? `Bootstrap admin password: ${running.bootstrapAdminPassword}` : "Bootstrap admin password: (existing store, unchanged)",
    running.bootstrapAdminApiKey ? `Bootstrap admin API key: ${running.bootstrapAdminApiKey}` : "Bootstrap admin API key: (existing store, unchanged)",
    ""
  ].join(`
`));
  const shutdown = () => {
    running.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
