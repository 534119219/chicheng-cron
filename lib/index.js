/**
 * chicheng-cron — host half
 *
 * A cron-style scheduled task engine for the dsh web profile:
 *   - persists tasks + run history under $DSH_HOME/cron/store.json
 *   - parses standard 5/6-field cron expressions (plus @shorthands and
 *     @every <n>s|m|h|d) and computes next occurrences in local time
 *   - executes tasks: shell / python / node scripts, skills (instructions
 *     inlined via ctx.skills), and free-form agent tasks (spawned through
 *     the dsh headless profile)
 *   - exposes a fenced JSON API at /cron/api/<method> for the client half
 *
 * No third-party runtime dependencies: the plugin imports Node built-ins
 * only and talks to services provided by the composed web profile.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------- identity

const name = "chicheng-cron";
const inject = ["webServer", "webRuntime"];

// ---------------------------------------------------------------- paths

const DATA_ROOT = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, "cron")
  : join(homedir(), ".dsh", "cron");
const STORE_PATH = join(DATA_ROOT, "store.json");
const RUNS_DIR = join(DATA_ROOT, "runs");
/** Dedicated workspace directory that hosts agent/skill task sessions (sidebar group "定时任务"). */
const GROUP_WORKSPACE_DIR = join(DATA_ROOT, "workspace");
let groupWorkspaceId = null;
/** Last ensure/create/resolve error, surfaced by the `status` API for diagnostics. */
let groupErrorNote = null;

/** The sidebar session root that mirrors `dshHomePath('sessions')`. */
function sessionsRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "sessions");
}

/**
 * Resolve the workspace registry service for this plugin's scope.
 *
 * Plain property access only resolves services available through the cordis
 * scope chain (ancestors); `dsh-workspace` mounts as a sibling entry, so its
 * service is NOT visible as `ctx.workspaceRegistry`. `ctx.get()` reads the
 * reflect store without the inject requirement and finds sibling services.
 * Returns null when the service is unavailable so the plugin degrades
 * gracefully on profiles without a workspace registry.
 */
function resolveWorkspaceRegistry(ctx) {
  try {
    if (ctx?.workspaceRegistry) return ctx.workspaceRegistry;
  } catch {
    // ignore and fall through
  }
  try {
    const found = ctx?.get?.("workspaceRegistry");
    if (found) return found;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Register the "定时任务" workspace (idempotent). Returns the workspace id,
 * or null when the workspace registry is unavailable.
 */
async function ensureGroupWorkspace(ctx) {
  if (groupWorkspaceId !== null) return groupWorkspaceId;
  const registry = resolveWorkspaceRegistry(ctx);
  if (registry === null) {
    groupErrorNote = "workspaceRegistry service unavailable (resolveWorkspaceRegistry returned null)";
    return null;
  }
  try {
    groupErrorNote = null;
    await mkdir(GROUP_WORKSPACE_DIR, { recursive: true });
    let created;
    try {
      created = await registry.create(GROUP_WORKSPACE_DIR, "定时任务");
    } catch (error) {
      groupErrorNote = `workspace create failed: ${error instanceof Error ? error.message : String(error)}`;
      // create may reject when the record already exists in some deployments; resolve below is authoritative.
      console.warn("[chicheng-cron] workspace create note:", groupErrorNote);
    }
    let byPath;
    try {
      byPath = await registry.resolveByPath?.(GROUP_WORKSPACE_DIR);
    } catch (error) {
      groupErrorNote = `workspace resolveByPath failed: ${error instanceof Error ? error.message : String(error)}`;
      // ignore; fall back to the create return value below
    }
    groupWorkspaceId = (created?.id ?? created?.workspaceId ?? byPath?.id ?? byPath?.workspaceId) ?? null;
    if (groupWorkspaceId === null && groupErrorNote === null) {
      groupErrorNote = "workspace neither created nor resolvable by path";
    }
    return groupWorkspaceId;
  } catch (error) {
    groupErrorNote = `workspace ensure failed: ${error instanceof Error ? error.message : String(error)}`;
    console.warn("[chicheng-cron] workspace register failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** True when the workspace registry can actually attribute a session. */
function canGroupSessions(ctx) {
  return resolveWorkspaceRegistry(ctx) !== null;
}

/**
 * Find the session that an agent/skill run just created (newest session
 * directory whose mtime falls inside this run's window), or null.
 */
async function findRunSessionId(startedAtMs) {
  const root = sessionsRoot();
  let projects;
  try {
    projects = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const from = startedAtMs - 5000;
  const to = Date.now() + 2000;
  const candidates = [];
  for (const project of projects) {
    if (!project.isDirectory() || !project.name.startsWith("--") || !project.name.endsWith("--")) continue;
    let sessionEntries;
    try {
      sessionEntries = await readdir(join(root, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of sessionEntries) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, project.name, entry.name);
      let info;
      try {
        info = await stat(dir);
      } catch {
        continue;
      }
      if (info.mtimeMs >= from && info.mtimeMs <= to) {
        candidates.push({ id: entry.name, info });
        break;
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs);
  return candidates[0].id;
}

/**
 * Attach the session that an agent/skill run just created to the
 * "定时任务" workspace so the sidebar groups it instead of leaving it
 * Ungrouped.
 */
async function attachAgentSession(ctx, startedAtMs) {
  const registry = resolveWorkspaceRegistry(ctx);
  if (registry === null) return;
  const wsId = await ensureGroupWorkspace(ctx);
  if (wsId === null) return;
  const sessionId = await findRunSessionId(startedAtMs);
  if (sessionId === null) return;
  try {
    const ws = registry.get(wsId);
    if (ws && typeof ws.attachSession === "function") {
      await ws.attachSession(sessionId);
      console.info(`[chicheng-cron] session ${sessionId} attached to workspace 定时任务`);
    }
  } catch (error) {
    console.warn("[chicheng-cron] attach session failed:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Archive the session a run just created ("成功后归档会话"): it disappears
 * from the sidebar grouping surfaces while its log remains. Returns the
 * archived session id, or null when there is nothing to archive.
 */
async function archiveRunSession(ctx, startedAtMs) {
  const registry = resolveWorkspaceRegistry(ctx);
  if (registry === null || typeof registry.archiveSession !== "function") return null;
  const sessionId = await findRunSessionId(startedAtMs);
  if (sessionId === null) return null;
  try {
    await registry.archiveSession(sessionId);
    return sessionId;
  } catch (error) {
    console.warn("[chicheng-cron] archive session failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Resolve the pushNotifier service provided by chicheng-push (scope-independent). */
function resolvePushNotifier(ctx) {
  try {
    if (ctx?.pushNotifier) return ctx.pushNotifier;
  } catch {
    // fall through
  }
  try {
    const found = ctx?.get?.("pushNotifier");
    if (found) return found;
  } catch {
    // ignore
  }
  return null;
}

/** List push channels: in-process service first, /push/api/list HTTP fallback. */
async function listPushChannels(ctx) {
  try {
    const notifier = resolvePushNotifier(ctx);
    if (notifier && typeof notifier.list === "function") {
      const channels = await notifier.list();
      if (Array.isArray(channels)) return channels;
    }
  } catch (error) {
    console.warn("[chicheng-cron] push channels (service) failed:", error instanceof Error ? error.message : String(error));
  }
  try {
    const port = ctx?.webServer?.port ?? 3080;
    const response = await fetch(`http://127.0.0.1:${port}/push/api/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const parsed = await response.json().catch(() => null);
    if (parsed?.ok === true && Array.isArray(parsed.value?.channels)) return parsed.value.channels;
  } catch (error) {
    console.warn("[chicheng-cron] push channels (http) failed:", error instanceof Error ? error.message : String(error));
  }
  return [];
}

/** Resolve the messaging-core gateway service (scope-independent). */
function resolveMessaging(ctx) {
  try {
    if (ctx?.messaging) return ctx.messaging;
  } catch {
    // fall through
  }
  try {
    const found = ctx?.get?.("messaging");
    if (found) return found;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Enumerate messaging-core push targets: every known chat (platform + chatId,
 * mirroring the send_message tool) surfaced by /messaging/status.
 */
async function listMessagingTargets(ctx) {
  try {
    const port = ctx?.webServer?.port ?? 3080;
    const response = await fetch(`http://127.0.0.1:${port}/messaging/status`, {
      headers: { accept: "application/json" },
    });
    const parsed = await response.json().catch(() => null);
    if (parsed && Array.isArray(parsed.platforms)) {
      const connected = new Set(parsed.platforms.filter((p) => p.connected).map((p) => p.id));
      const targets = [];
      for (const chat of Array.isArray(parsed.chats) ? parsed.chats : []) {
        if (!chat || !chat.platform || !chat.chatId) continue;
        targets.push({
          id: `messaging:${chat.platform}:${chat.chatId}`,
          name: `${chat.platform}${chat.userName ? ` · ${chat.userName}` : ` · ${chat.chatId}`}`,
          type: "messaging",
          enabled: connected.has(chat.platform),
          source: "messaging",
        });
      }
      return { available: targets.length > 0 || connected.size > 0, targets, connectedPlatforms: [...connected] };
    }
  } catch (error) {
    console.warn("[chicheng-cron] messaging targets failed:", error instanceof Error ? error.message : String(error));
  }
  return { available: false, targets: [], connectedPlatforms: [] };
}

/** Substitute {placeholder} tokens in a push template. */
function renderTemplate(template, values) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => (values[key] !== undefined && values[key] !== null ? String(values[key]) : `{${key}}`));
}

const PUSH_STATUS_LABELS = { done: "完成", failed: "失败", timeout: "超时", running: "运行中", ok: "成功" };

/** Send the completion push for a finished run. Returns the push plugin result or null. */
async function sendTaskPush(ctx, task, record) {
  try {
    if (!task.pushEnabled) return null;
    const rawChannel = String(task.pushChannel ?? "").trim();
    const output = await readFile(record.outputPath, "utf8").catch(() => "");
    const durationMs = record.durationMs;
    const durationText = durationMs === null || durationMs === undefined
      ? ""
      : durationMs < 1000
        ? `${Math.round(durationMs)}ms`
        : `${(durationMs / 1000).toFixed(1)}s`;
    const values = {
      name: task.name,
      type: task.type,
      status: PUSH_STATUS_LABELS[record.status] ?? record.status,
      exitCode: record.exitCode ?? "",
      duration: durationText,
      time: new Date(record.startedAt).toLocaleString(),
      output: output.slice(0, 800),
    };
    const title = renderTemplate(
      task.pushTitle && String(task.pushTitle).trim() !== "" ? task.pushTitle : `定时任务「{name}」执行完成`,
      values,
    );
    const userContent = task.pushContent && String(task.pushContent).trim() !== "";
    const defaultContent = `状态：{status}（exit {exitCode}）\n耗时：{duration}\n完成时间：{time}`;
    const content = renderTemplate(userContent ? task.pushContent : defaultContent, values);
    // When the user did not write a custom template, append the run output
    // (the agent's final answer for agent/skill tasks) automatically.
    const effectiveContent = !userContent && output.trim() !== ""
      ? `${content}\n\n输出：\n${output.slice(0, 800)}`
      : content;
    // messaging-core target: "messaging:<platform>:<chatId>"
    if (rawChannel.startsWith("messaging:")) {
      const rest = rawChannel.slice("messaging:".length);
      const sep = rest.indexOf(":");
      if (sep <= 0) return { ok: false, error: `无效的消息平台目标 "${rawChannel}"` };
      const platform = rest.slice(0, sep);
      const chatId = rest.slice(sep + 1);
      const messaging = resolveMessaging(ctx);
      if (!messaging || typeof messaging.send !== "function") {
        return { ok: false, error: "messaging-core 服务不可用（未安装或未挂载）" };
      }
      try {
        await messaging.send(platform, chatId, `${title}\n\n${effectiveContent}`);
        return { ok: true, sent: 1, total: 1, source: "messaging", platform, chatId };
      } catch (error) {
        return { ok: false, sent: 0, total: 1, source: "messaging", error: error instanceof Error ? error.message : String(error) };
      }
    }
    const channels = rawChannel !== "" ? [rawChannel] : "all";
    const notifier = resolvePushNotifier(ctx);
    if (notifier && typeof notifier.send === "function") {
      return await notifier.send({ title, content: effectiveContent, channels });
    }
    const port = ctx?.webServer?.port ?? 3080;
    const response = await fetch(`http://127.0.0.1:${port}/push/api/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content: effectiveContent, channels }),
    });
    const parsed = await response.json().catch(() => null);
    return parsed ?? { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Default working directory for script/agent tasks (the app invocation dir). */
function defaultCwd() {
  try {
    return process.cwd();
  } catch {
    return homedir();
  }
}

// ---------------------------------------------------------------- store

const EMPTY_STORE = { version: 1, tasks: [], runs: [], seq: 0 };
let store = structuredClone(EMPTY_STORE);
let storeDirtyTimer = null;

async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tasks)) store = parsed;
  } catch {
    store = structuredClone(EMPTY_STORE);
  }
  if (!Array.isArray(store.tasks)) store.tasks = [];
  if (!Array.isArray(store.runs)) store.runs = [];
  if (typeof store.seq !== "number") store.seq = store.tasks.length;
}

/** Debounced atomic persist (tolerates crashes: tmp + rename). */
function scheduleSave() {
  if (storeDirtyTimer !== null) return;
  storeDirtyTimer = setTimeout(() => {
    storeDirtyTimer = null;
    void flushStore();
  }, 150);
}

async function flushStore() {
  try {
    await mkdir(DATA_ROOT, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await rename(tmp, STORE_PATH);
  } catch (error) {
    console.error(`[chicheng-cron] store flush failed:`, error);
  }
}

// ---------------------------------------------------------------- cron engine

const ANY = Symbol("any");

const MONTH_NAMES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DOW_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const SPECIAL_CRON = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function parseFieldToken(token, { min, max, names }, result) {
  const named = names ? names[token.toLowerCase()] : undefined;
  if (named !== undefined) {
    if (named < min || named > max) throw new Error(`field value "${token}" out of range ${min}-${max}`);
    result.add(named);
    return;
  }
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    if (value < min || value > max) throw new Error(`field value "${token}" out of range ${min}-${max}`);
    result.add(value);
    return;
  }
  const stepMatch = /^(\*|(\d+)-(\d+)|(\d+))(?:\/(\d+))?$/.exec(token);
  if (stepMatch) {
    let from = min;
    let to = max;
    let step = 1;
    if (stepMatch[2] !== undefined) {
      from = Number(stepMatch[2]);
      to = Number(stepMatch[3]);
    } else if (stepMatch[4] !== undefined) {
      from = Number(stepMatch[4]);
      to = Number(stepMatch[4]);
    }
    if (stepMatch[5] !== undefined) step = Math.max(1, Math.floor(Number(stepMatch[5])));
    if (from < min || to > max || from > to) throw new Error(`field range ${from}-${to} out of bounds ${min}-${max}`);
    for (let v = from; v <= to; v += step) result.add(v);
    return;
  }
  throw new Error(`invalid cron field token "${token}"`);
}

function parseField(text, { min, max, names }) {
  const result = new Set();
  for (const rawToken of text.split(",")) {
    const token = rawToken.trim();
    if (token === "") continue;
    if (token === "*") return ANY;
    parseFieldToken(token, { min, max, names }, result);
  }
  if (result.size === 0) return ANY;
  return result;
}

const matches = (field, value) => field === ANY || field.has(value);

/** Parse a cron expression into a normalized descriptor. Throws on invalid input. */
function parseCron(expression) {
  const input = String(expression ?? "").trim();
  if (input === "") throw new Error("cron 表达式不能为空");

  if (input.startsWith("@every")) {
    const token = input.slice(6).trim();
    const match = /^(\d+)\s*(s|m|h|d)?$/.exec(token);
    if (!match) throw new Error(`无效的 @every 表达式 "${input}"，应为 @every <n>[s|m|h|d]`);
    const factors = { s: 1, m: 60, h: 3600, d: 86400 };
    const unit = match[2] ?? "m";
    const everySeconds = Math.max(1, Number(match[1]) * factors[unit]);
    return { kind: "every", everySeconds, raw: input };
  }

  const text = SPECIAL_CRON[input.toLowerCase()] ?? input;
  const parts = text.split(/\s+/).filter((part) => part !== "");
  if (parts.length !== 5 && parts.length !== 6) {
    throw new Error(`cron 表达式需要 5 或 6 个字段（当前 ${parts.length} 个）：${input}`);
  }
  const hasSeconds = parts.length === 6;
  const idx = hasSeconds ? 1 : 0;
  const fields = {
    seconds: hasSeconds ? parseField(parts[0], { min: 0, max: 59 }) : undefined,
    minutes: parseField(parts[idx], { min: 0, max: 59 }),
    hours: parseField(parts[idx + 1], { min: 0, max: 23 }),
    dom: parseField(parts[idx + 2], { min: 1, max: 31 }),
    month: parseField(parts[idx + 3], { min: 1, max: 12, names: MONTH_NAMES }),
    dow: parseField(parts[idx + 4], { min: 0, max: 7, names: DOW_NAMES }),
  };
  // Normalize 7 (Sunday) to 0 for matching.
  if (fields.dow !== ANY && fields.dow.has(7)) {
    const set = new Set(fields.dow);
    set.delete(7);
    set.add(0);
    fields.dow = set;
  }
  return { kind: "cron", fields, raw: input };
}

function roundAfter(secondsMatch, base) {
  // Round a Date up to the next candidate minute (or second when seconds are matched).
  const t = new Date(base);
  if (secondsMatch !== undefined) {
    t.setSeconds(t.getSeconds() + 1, 0);
  } else {
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() + 1);
  }
  return t;
}

/** Next occurrence strictly after `base` for a parsed descriptor, or null. */
function nextCronTime(parsed, base) {
  if (parsed.kind === "every") {
    const aligned = Math.floor(base.getTime() / 1000 / parsed.everySeconds) * parsed.everySeconds * 1000;
    let next = aligned;
    while (next <= base.getTime()) next += parsed.everySeconds * 1000;
    return new Date(next);
  }
  const fields = parsed.fields;
  const seconds = fields.seconds;
  const MAX = base.getTime() + 5 * 366 * 24 * 60 * 60 * 1000;
  const t = roundAfter(seconds, base);

  while (t.getTime() <= MAX) {
    if (!matches(fields.month, t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    const domOk = matches(fields.dom, t.getDate());
    const dowOk = matches(fields.dow, t.getDay());
    const domAny = fields.dom === ANY;
    const dowAny = fields.dow === ANY;
    const dayOk = domAny && dowAny ? true : domAny ? dowOk : dowAny ? domOk : domOk || dowOk;
    if (!dayOk) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matches(fields.hours, t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!matches(fields.minutes, t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    if (seconds !== undefined) {
      const set = seconds === ANY ? new Set([0]) : seconds;
      let chosen = -1;
      for (const s of set) {
        if (s >= t.getSeconds() && (chosen === -1 || s < chosen)) chosen = s;
      }
      if (chosen === -1) {
        t.setMinutes(t.getMinutes() + 1, 0, 0);
        continue;
      }
      t.setSeconds(chosen, 0);
    } else {
      t.setSeconds(0, 0);
    }
    return t;
  }
  return null;
}

/** Up to `count` next occurrences after `from` (milliseconds epoch), or null each. */
function previewOccurrences(parsed, fromMs, count) {
  const out = [];
  let cursor = new Date(fromMs);
  for (let i = 0; i < count; i += 1) {
    const next = nextCronTime(parsed, cursor);
    if (next === null) break;
    out.push(next);
    cursor = new Date(next.getTime() + 1000);
  }
  return out;
}

/** Validate a cron/every descriptor; throws a friendly error on bad input. */
function validateSchedule(task) {
  if (task.everySeconds !== undefined && task.everySeconds !== null && String(task.everySeconds) !== "") {
    const n = Number(task.everySeconds);
    if (!Number.isFinite(n) || n < 1) throw new Error("@every 间隔必须 >= 1 秒");
    return { kind: "every", everySeconds: Math.max(1, Math.floor(n)), raw: `@every ${Math.floor(n)}s` };
  }
  return parseCron(task.cron);
}

// ---------------------------------------------------------------- executor

/** Path of the dsh launcher script when the web app was started by the CLI. */
function dshBinPath() {
  const argv1 = process.argv[1];
  if (argv1 && /bin\.js$/.test(argv1.replace(/\\/g, "/"))) {
    try {
      return resolve(argv1);
    } catch {
      return argv1;
    }
  }
  return null;
}

/**
 * Make sure the headless profile exists without running a job or an LLM
 * call: `dsh --profile headless --help` initializes the profile (first-use
 * auto-init) and exits immediately. Without this, the first scheduled
 * agent/skill run would pay the one-time initialization cost inside a
 * spawned run that the user cannot watch.
 */
function warmUpHeadlessProfile() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  if (existsSync(join(dshHome, "profiles", "headless", "package.json"))) return;
  const bin = dshBinPath();
  if (bin === null) return;
  try {
    const child = spawn(process.execPath, [bin, "--profile", "headless", "--help"], {
      cwd: defaultCwd(),
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });
    child.unref();
  } catch {
    // warm-up is best-effort; agent runs still work (they just initialize on first use)
  }
}

const PYTHON_CMDS = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];

async function resolvePython() {
  for (const cmd of PYTHON_CMDS) {
    try {
      const probe = await new Promise((resolveProbe) => {
        const child = spawn(cmd, ["--version"], { stdio: "ignore", windowsHide: true });
        child.on("error", () => resolveProbe(false));
        child.on("exit", (code) => resolveProbe(code === 0));
      });
      if (probe) return cmd;
    } catch {
      // try next
    }
  }
  return PYTHON_CMDS[0];
}

let pythonLauncher = null;

/**
 * Execute one task run. Writes a run record, spawns the underlying command,
 * captures bounded output, and finalizes the record.
 */
async function executeRun(ctx, task, reason) {
  const runId = randomUUID();
  const runDir = join(RUNS_DIR, runId);
  const outputPath = join(runDir, "output.txt");
  const startedAt = new Date().toISOString();
  const record = {
    runId,
    taskId: task.id,
    name: task.name,
    type: task.type,
    reason,
    status: "running",
    startedAt,
    exitCode: null,
    durationMs: null,
    outputLength: 0,
    outputPath,
  };
  store.runs.unshift(record);
  if (store.runs.length > 200) store.runs.length = 200;
  scheduleSave();

  const finalize = (patch) => {
    const now = Date.now();
    const durationMs = now - new Date(startedAt).getTime();
    Object.assign(record, patch, { durationMs, status: patch.status ?? "done" });
    task.lastRunAt = startedAt;
    task.lastRunId = runId;
    task.lastStatus = record.status === "done" ? (record.exitCode === 0 ? "ok" : "failed") : record.status;
    scheduleSave();
  };

  try {
    await mkdir(runDir, { recursive: true });
    const workCwd = task.cwd && String(task.cwd).trim() !== "" ? resolve(String(task.cwd)) : defaultCwd();
    const groups = (task.type === "agent" || task.type === "skill") && task.groupSessions !== false;
    const spawnCwd = groups ? GROUP_WORKSPACE_DIR : workCwd;
    if (groups) await mkdir(GROUP_WORKSPACE_DIR, { recursive: true });
    const child = await spawnForTask(task, spawnCwd, workCwd, runDir, ctx);
    const chunks = [];
    let total = 0;
    const MAX_BYTES = 512 * 1024;
    const append = (buffer) => {
      const remaining = MAX_BYTES - total;
      if (remaining <= 0) return;
      const slice = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      chunks.push(slice);
      total += slice.length;
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let timedOut = false;
    let timer = null;
    if (task.timeoutMs && Number(task.timeoutMs) > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGKILL"); } catch { /* noop */ }
      }, Number(task.timeoutMs));
    }
    const exitCode = await new Promise((resolveExit) => {
      child.on("error", (error) => {
        chunks.push(Buffer.from(`\n[spawn error] ${error.message}`, "utf8"));
        resolveExit(-1);
      });
      child.on("close", (code) => resolveExit(code));
    });
    if (timer) clearTimeout(timer);
    if (total === 0 && exitCode !== 0) chunks.push(Buffer.from(`\n[exit code ${String(exitCode)}${timedOut ? " (timeout)" : ""}]`, "utf8"));
    let output = Buffer.concat(chunks).toString("utf8");
    if (total >= MAX_BYTES) output = `${output}\n... [output truncated at ${MAX_BYTES} bytes]\n`;
    await writeFile(outputPath, output, "utf8");
    finalize({
      exitCode,
      outputLength: Buffer.byteLength(output),
      status: timedOut ? "timeout" : "done",
    });
    const runStartedAt = new Date(startedAt).getTime();
    if (groups) await attachAgentSession(ctx, runStartedAt);
    if (task.pushEnabled) {
      record.pushResult = await sendTaskPush(ctx, task, record);
      scheduleSave();
    }
    if (task.archiveOnSuccess && record.status === "done" && record.exitCode === 0) {
      // "成功后归档" = archive the conversation this run created (agent/skill
      // tasks): it disappears from the sidebar grouping surfaces, logs remain.
      const sessionId = await archiveRunSession(ctx, runStartedAt);
      if (sessionId !== null) {
        record.archivedSession = sessionId;
        scheduleSave();
      }
    }
    return record;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(outputPath, `[chicheng-cron] run failed: ${message}\n`, "utf8").catch(() => {});
    finalize({ exitCode: -1, status: "failed", outputLength: Buffer.byteLength(message) });
    if (task.pushEnabled) {
      record.pushResult = await sendTaskPush(ctx, task, record);
      scheduleSave();
    }
    return record;
  }
}

/** Choose the spawn call for a task type. `cwd` is the process working
 * directory; `workCwd` is the user-facing work directory for agent prompts. */
async function spawnForTask(task, cwd, workCwd, runDir, ctx) {
  const windows = process.platform === "win32";
  switch (task.type) {
    case "shell": {
      const scriptPath = join(runDir, windows ? "run.cmd" : "run.sh");
      const body = String(task.script ?? "");
      await writeFile(scriptPath, windows ? body : `#!/bin/sh\n${body}`, "utf8");
      if (windows) {
        return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", scriptPath], { cwd, windowsHide: true, windowsVerbatimArguments: true, stdio: ["ignore", "pipe", "pipe"] });
      }
      return spawn("/bin/sh", [scriptPath], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    }
    case "python": {
      if (pythonLauncher === null) pythonLauncher = await resolvePython();
      const scriptPath = join(runDir, "run.py");
      await writeFile(scriptPath, String(task.script ?? ""), "utf8");
      return spawn(pythonLauncher, [scriptPath], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    }
    case "node": {
      const scriptPath = join(runDir, "run.mjs");
      await writeFile(scriptPath, String(task.script ?? ""), "utf8");
      return spawn(process.execPath, [scriptPath], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    }
    case "skill":
    case "agent": {
      const prompt = await buildAgentPrompt(task, ctx, workCwd);
      const bin = dshBinPath();
      const args = bin !== null
        ? [bin, "--profile", "headless", prompt]
        : ["--profile", "headless", prompt];
      return spawn(bin !== null ? process.execPath : "dsh", args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    }
    default:
      throw new Error(`未知任务类型 "${task.type}"`);
  }
}

/** Compose the headless-agent prompt: inline skill instructions when present.
 * `workCwd` is the user-facing work directory (absolute paths guidance). */
async function buildAgentPrompt(task, ctx, workCwd) {
  const when = new Date().toLocaleString();
  const header = `定时任务触发了（${when}）。请直接完成任务，不要询问用户。`;
  const workHint = workCwd && String(workCwd).trim() !== ""
    ? `\n本次任务的工作目录是：${workCwd}（如需读写该目录下的文件，请使用绝对路径。）`
    : "";
  if (task.type === "skill" && task.skill) {
    const skillText = await loadSkillText(task.skill, ctx);
    const extra = String(task.prompt ?? "").trim();
    return [
      header,
      `请按照以下 skill "${task.skill}" 的完整指引来执行本次任务。`,
      skillText !== null ? `\n===== skill: ${task.skill} =====\n${skillText}\n===== skill 结束 =====` : `（注意：提供名为 "${task.skill}" 的 skill 内容未能读取，请基于可用 skill 目录自行完成。）`,
      extra !== "" ? `\n附加说明：\n${extra}` : "",
      workHint,
      "\n完成后请简明汇报结果（做了什么、输出/结果是什么）。",
    ].join("\n");
  }
  return `${header}\n${String(task.prompt ?? "")}${workHint}`;
}

/** Standard user skill roots to scan (project + user + bundled). */
function skillRoots() {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  const agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), ".agents");
  const roots = [
    join(dshHome, "skills"),
    join(agentsHome, "skills"),
    ...(process.env.DSH_BUNDLED_SKILL_DIR ? [process.env.DSH_BUNDLED_SKILL_DIR] : []),
  ];
  try {
    roots.push(join(defaultCwd(), ".dsh", "skills"), join(defaultCwd(), ".agents", "skills"));
  } catch {
    // cwd unavailable
  }
  return roots;
}

/** Read one skill's body from disk, trying every root and both layouts. */
async function readSkillBodyFromDisk(skillName) {
  for (const root of skillRoots()) {
    for (const form of [join(root, skillName, "SKILL.md"), join(root, `${skillName}.md`)]) {
      try {
        const body = await readFile(form, "utf8");
        if (body.trim() !== "") return body;
      } catch {
        // try next
      }
    }
  }
  return null;
}

/** Read a skill body from ctx.skills (preferred) or a filesystem scan fallback. */
async function loadSkillText(skillName, ctx) {
  try {
    if (ctx?.skills?.get) {
      const loaded = await ctx.skills.get(skillName, {});
      if (loaded && loaded.body && loaded.body.trim() !== "") return loaded.body;
    }
  } catch {
    // fall through to filesystem scan
  }
  try {
    return await readSkillBodyFromDisk(skillName);
  } catch {
    return null;
  }
}

/** Scan skill roots on disk (frontmatter name/description). Junction/type agnostic. */
async function scanSkillRoots() {
  const out = [];
  for (const root of skillRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      let body = "";
      for (const form of [join(root, entry.name, "SKILL.md"), join(root, `${entry.name}.md`)]) {
        try {
          const candidate = await readFile(form, "utf8");
          if (candidate.trim() !== "") {
            body = candidate;
            break;
          }
        } catch {
          // try next form
        }
      }
      if (body === "") continue;
      const nameMatch = /^name:\s*(.+)$/m.exec(body);
      const descMatch = /^description:\s*(.+)$/m.exec(body);
      out.push({
        name: (nameMatch?.[1] ?? entry.name.replace(/\.md$/, "")).trim(),
        description: (descMatch?.[1] ?? "").trim(),
        whenToUse: "",
      });
    }
  }
  return out;
}

/** Enumerate skills for the UI dropdown: registry catalog + disk scan union. */
async function listSkills(ctx) {
  const byName = new Map();
  try {
    if (ctx?.skills?.list) {
      const found = await ctx.skills.list({});
      for (const skill of Array.isArray(found) ? found : []) {
        if (skill && typeof skill.name === "string") {
          byName.set(skill.name, {
            name: skill.name,
            description: skill.description ?? "",
            whenToUse: skill.whenToUse ?? "",
          });
        }
      }
    }
  } catch (error) {
    console.warn(`[chicheng-cron] skills registry list failed:`, error);
  }
  try {
    for (const skill of await scanSkillRoots()) {
      if (skill.name !== "" && !byName.has(skill.name)) byName.set(skill.name, skill);
    }
  } catch (error) {
    console.warn(`[chicheng-cron] disk skill scan failed:`, error);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- scheduler

let wakeTimer = null;
let tearDown = false;
let currentCtx = null;

/** (Re)arm the single wake timer at the earliest next occurrence. */
function reschedule() {
  if (wakeTimer !== null) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (tearDown) return;
  let earliest = null;
  let earliestTask = null;
  const now = Date.now();
  for (const task of store.tasks) {
    if (!task.enabled) continue;
    let parsed;
    try {
      parsed = validateSchedule(task);
    } catch {
      continue;
    }
    const next = nextCronTime(parsed, new Date(now));
    if (next === null) continue;
    const ms = next.getTime() - now;
    task.nextRunAt = next.toISOString();
    if (earliest === null || ms < earliest) {
      earliest = ms;
      earliestTask = task;
    }
  }
  for (const task of store.tasks) {
    if (!task.enabled || task === earliestTask) continue;
    if (earliest !== null) {
      try {
        const parsed = validateSchedule(task);
        const next = nextCronTime(parsed, new Date(now));
        task.nextRunAt = next === null ? null : next.toISOString();
      } catch {
        task.nextRunAt = null;
      }
    }
  }
  scheduleSave();
  if (earliest !== null && earliestTask !== null) {
    const delay = Math.min(Math.max(earliest, 0), 0x7fffffff);
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      onWake();
    }, delay);
    wakeTimer.unref?.();
  }
}

/** Wake: fire every task whose next occurrence is due, then re-arm. */
function onWake() {
  if (tearDown) return;
  const now = Date.now();
  const due = [];
  for (const task of store.tasks) {
    if (!task.enabled) continue;
    let parsed;
    try {
      parsed = validateSchedule(task);
    } catch {
      continue;
    }
    const next = nextCronTime(parsed, new Date(now - 60000));
    if (next !== null && next.getTime() <= now) due.push(task);
  }
  for (const task of due) {
    void executeRun(currentCtx, task, "cron");
  }
  reschedule();
}

// ---------------------------------------------------------------- API wire

const MAX_BODY_BYTES = 1 << 20;

class CronError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new CronError("bad-request", "request body too large", 413);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new CronError("bad-request", "request body is not valid JSON");
  }
}

function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(payload);
}

function writeOk(res, value) {
  writeJson(res, 200, { ok: true, value });
}

function writeError(res, error) {
  if (error instanceof CronError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  writeJson(res, 500, { ok: false, error: { code: "internal", message } });
}

function header(headers, key) {
  const value = headers[key];
  return typeof value === "string" ? value : undefined;
}

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isTrustedApiRequest(request, trustedHosts) {
  const host = header(request.headers, "host");
  if (host === undefined) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === undefined) return false;
  const hosts = Array.isArray(trustedHosts) ? trustedHosts : [];
  const trusted = hosts.some((entry) => {
    const entryUrl = parseAuthority(entry);
    if (entryUrl === undefined) return false;
    return entryUrl.hostname === hostUrl.hostname && (entryUrl.port === "" || entryUrl.port === hostUrl.port);
  });
  if (!isLoopbackHostname(hostUrl.hostname) && !trusted) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
  const origin = header(request.headers, "origin");
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- API handlers

function requireString(payload, key) {
  const value = payload?.[key];
  if (typeof value !== "string" || value.trim() === "") throw new CronError("bad-request", `missing or invalid "${key}"`);
  return value;
}

function requireId(payload) {
  return requireString(payload, "id");
}

function publicTask(task) {
  return {
    id: task.id,
    name: task.name,
    type: task.type,
    cron: task.cron ?? "",
    everySeconds: task.everySeconds ?? null,
    scheduleText: task.everySeconds ? `@every ${task.everySeconds}s` : (task.cron ?? ""),
    enabled: task.enabled !== false,
    script: task.script ?? "",
    skill: task.skill ?? "",
    prompt: task.prompt ?? "",
    cwd: task.cwd ?? "",
    timeoutMs: task.timeoutMs ?? 0,
    groupSessions: task.groupSessions !== false,
    pushEnabled: task.pushEnabled === true,
    pushChannel: task.pushChannel ?? "",
    pushTitle: task.pushTitle ?? "",
    pushContent: task.pushContent ?? "",
    archiveOnSuccess: task.archiveOnSuccess === true,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    nextRunAt: task.nextRunAt ?? null,
    lastRunAt: task.lastRunAt ?? null,
    lastStatus: task.lastStatus ?? null,
    lastRunId: task.lastRunId ?? null,
  };
}

function buildApi(ctx) {
  return {
    list: async () => {
      return { tasks: store.tasks.map(publicTask), now: new Date().toISOString() };
    },

    status: async () => {
      const registry = resolveWorkspaceRegistry(ctx);
      let workspaces = [];
      try {
        if (registry !== null && typeof registry.list === "function") {
          workspaces = registry.list().map((entity) => ({
            id: entity?.id,
            title: entity?.title,
            path: entity?.path,
            sessionIds: Array.isArray(entity?.sessionIds) ? [...entity.sessionIds] : [],
          }));
        }
      } catch (error) {
        console.warn("[chicheng-cron] status: workspace list failed:", error instanceof Error ? error.message : String(error));
      }
      return {
        registryAvailable: registry !== null,
        canGroupSessions: canGroupSessions(ctx),
        groupWorkspaceId,
        groupErrorNote,
        groupDir: GROUP_WORKSPACE_DIR,
        sessionsRoot: sessionsRoot(),
        workspaces,
      };
    },

    preview: async (payload) => {
      const cron = payload?.cron ?? "";
      const everySeconds = payload?.everySeconds ?? null;
      try {
        const parsed = validateSchedule({ cron, everySeconds });
        const from = payload?.from ? new Date(payload.from) : new Date();
        const times = previewOccurrences(parsed, from.getTime(), 10);
        return {
          ok: true,
          scheduleText: parsed.raw,
          next: times.map((date) => date.toISOString()),
        };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    save: async (payload) => {
      const task = payload?.task ?? payload;
      if (!task || typeof task !== "object") throw new CronError("bad-request", "task object required");
      const nameValue = requireString(task, "name");
      const type = requireString(task, "type");
      if (!["shell", "python", "node", "skill", "agent"].includes(type)) {
        throw new CronError("bad-request", `unsupported task type "${type}"`);
      }
      validateSchedule({ cron: task.cron ?? "", everySeconds: task.everySeconds ?? null });
      if (type === "skill" && !String(task.skill ?? "").trim()) {
        throw new CronError("bad-request", "skill 类型任务必须选择 skill 名称");
      }
      if ((type === "agent") && !String(task.prompt ?? "").trim()) {
        throw new CronError("bad-request", "agent 类型任务必须填写提示词");
      }
      if ((type === "shell" || type === "python" || type === "node") && !String(task.script ?? "").trim()) {
        throw new CronError("bad-request", `${type} 类型任务必须填写脚本内容`);
      }

      const nowIso = new Date().toISOString();
      let savedIndex = -1;
      if (typeof task.id === "string" && task.id !== "") {
        const existing = store.tasks.find((candidate) => candidate.id === task.id);
        if (!existing) throw new CronError("not-found", `task "${task.id}" not found`, 404);
        savedIndex = store.tasks.indexOf(existing);
        Object.assign(existing, {
          name: nameValue,
          type,
          cron: String(task.cron ?? "").trim(),
          everySeconds: task.everySeconds ?? null,
          enabled: task.enabled !== false,
          script: String(task.script ?? ""),
          skill: String(task.skill ?? "").trim(),
          prompt: String(task.prompt ?? ""),
          cwd: String(task.cwd ?? "").trim(),
          timeoutMs: Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) : 0,
          groupSessions: task.groupSessions !== false,
          pushEnabled: task.pushEnabled === true,
          pushChannel: String(task.pushChannel ?? "").trim(),
          pushTitle: String(task.pushTitle ?? ""),
          pushContent: String(task.pushContent ?? ""),
          archiveOnSuccess: task.archiveOnSuccess === true,
          updatedAt: nowIso,
        });
      } else {
        store.seq += 1;
        store.tasks.push({
          id: `task-${store.seq}-${randomUUID().slice(0, 8)}`,
          name: nameValue,
          type,
          cron: String(task.cron ?? "").trim(),
          everySeconds: task.everySeconds ?? null,
          enabled: task.enabled !== false,
          script: String(task.script ?? ""),
          skill: String(task.skill ?? "").trim(),
          prompt: String(task.prompt ?? ""),
          cwd: String(task.cwd ?? "").trim(),
          timeoutMs: Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) : 0,
          groupSessions: task.groupSessions !== false,
          pushEnabled: task.pushEnabled === true,
          pushChannel: String(task.pushChannel ?? "").trim(),
          pushTitle: String(task.pushTitle ?? ""),
          pushContent: String(task.pushContent ?? ""),
          archiveOnSuccess: task.archiveOnSuccess === true,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        savedIndex = store.tasks.length - 1;
      }
      scheduleSave();
      reschedule();
      return { task: publicTask(store.tasks[savedIndex]) };
    },

    remove: async (payload) => {
      const id = requireId(payload);
      const index = store.tasks.findIndex((task) => task.id === id);
      if (index === -1) throw new CronError("not-found", `task "${id}" not found`, 404);
      store.tasks.splice(index, 1);
      scheduleSave();
      reschedule();
      return { id, deleted: true };
    },

    toggle: async (payload) => {
      const id = requireId(payload);
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (!task) throw new CronError("not-found", `task "${id}" not found`, 404);
      task.enabled = payload.enabled !== false;
      task.updatedAt = new Date().toISOString();
      scheduleSave();
      reschedule();
      return { id, enabled: task.enabled, task: publicTask(task) };
    },

    runNow: async (payload) => {
      const id = requireId(payload);
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (!task) throw new CronError("not-found", `task "${id}" not found`, 404);
      const record = await executeRun(ctx, task, "manual");
      return { run: record };
    },

    pushChannels: async () => {
      const [pushList, messaging] = await Promise.all([listPushChannels(ctx), listMessagingTargets(ctx)]);
      const pushAvailable = pushList.length > 0;
      const channels = [
        ...pushList.map((channel) => ({
          id: channel?.id,
          name: channel?.name,
          type: channel?.type,
          enabled: channel?.enabled !== false,
          source: "push",
        })),
        ...messaging.targets,
      ];
      return {
        available: pushAvailable || messaging.available,
        pushAvailable,
        messagingAvailable: messaging.available,
        messagingPlatforms: messaging.connectedPlatforms,
        channels,
      };
    },

    runs: async (payload) => {
      const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;
      const limit = Math.min(200, Math.max(1, Number(payload?.limit) || 50));
      const runs = taskId === null
        ? store.runs.slice(0, limit)
        : store.runs.filter((run) => run.taskId === taskId).slice(0, limit);
      return {
        runs: runs.map((run) => ({
          runId: run.runId,
          taskId: run.taskId,
          name: run.name,
          reason: run.reason,
          status: run.status,
          startedAt: run.startedAt,
          exitCode: run.exitCode,
          durationMs: run.durationMs,
          outputLength: run.outputLength,
          pushResult: run.pushResult ?? null,
          archivedSession: run.archivedSession ?? null,
        })),
      };
    },

    runOutput: async (payload) => {
      const runId = requireString(payload, "runId");
      const record = store.runs.find((run) => run.runId === runId);
      if (!record) throw new CronError("not-found", `run "${runId}" not found`, 404);
      let output = "";
      try {
        output = await readFile(record.outputPath, "utf8");
      } catch {
        output = "(输出文件不可用)";
      }
      return { runId, output };
    },

    skills: async () => {
      const skills = await listSkills(ctx);
      return { skills };
    },
  };
}

// ---------------------------------------------------------------- teardown

function pruneRunFiles() {
  const keep = new Set(store.runs.slice(0, 100).map((run) => run.runId));
  void readdir(RUNS_DIR, { withFileTypes: true })
    .then((entries) => Promise.all(
      entries.filter((entry) => entry.isDirectory() && !keep.has(entry.name))
        .map((entry) => rm(join(RUNS_DIR, entry.name), { recursive: true, force: true }).catch(() => {}))
    ))
    .catch(() => {});
}

// ---------------------------------------------------------------- plugin body

async function apply(ctx, config) {
  await loadStore();
  await mkdir(RUNS_DIR, { recursive: true }).catch(() => {});
  currentCtx = ctx;
  warmUpHeadlessProfile();
  const fence = (req) => {
    try {
      return isTrustedApiRequest(req, ctx.webRuntime?.trustedHosts ?? []);
    } catch {
      return false;
    }
  };
  const api = buildApi(ctx);

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: "/cron/api",
    handler: async (req, res) => {
      if (!fence(req)) {
        writeJson(res, 403, { ok: false, error: { code: "forbidden", message: "forbidden" } });
        return;
      }
      if (req.method !== "POST") {
        writeJson(res, 405, { ok: false, error: { code: "method-error", message: "method not allowed" } });
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://cron.invalid").pathname;
      const method = pathname.startsWith("/cron/api/") ? pathname.slice(10) : undefined;
      if (method === undefined || method.includes("/") || method === "") {
        writeError(res, new CronError("not-found", "unknown cron API method", 404));
        return;
      }
      try {
        const payload = await readJsonBody(req);
        const handler = api[method];
        if (typeof handler !== "function") throw new CronError("not-found", `unknown cron API method "${method}"`, 404);
        writeOk(res, await handler(payload));
      } catch (error) {
        writeError(res, error);
      }
    },
  }), "chicheng-cron: /cron/api routes");

  ctx.effect(() => () => {
    tearDown = true;
    currentCtx = null;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeTimer = null;
    void flushStore();
    pruneRunFiles();
  }, "chicheng-cron: teardown");

  reschedule();
  ctx.logger?.info?.("[chicheng-cron] started, data root: " + DATA_ROOT);
}

export { apply, inject, name, _internals };

/** Testability surface for the scheduler primitives (stable within this version). */
const _internals = { parseCron, nextCronTime, previewOccurrences, validateSchedule, isTrustedApiRequest, defaultCwd, ensureGroupWorkspace, attachAgentSession, archiveRunSession, findRunSessionId, canGroupSessions, GROUP_WORKSPACE_DIR, sessionsRoot, renderTemplate, sendTaskPush, listPushChannels, listMessagingTargets, resolveMessaging };