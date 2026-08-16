/**
 * chicheng-cron — client half
 *
 * Injects a "定时任务" trigger button right below the sidebar's New Session
 * button and opens a management dialog (task CRUD, cron preview, run-now,
 * run history). Talks to the host half over the fenced /cron/api JSON API.
 *
 * Deliberately dependency-light: only `react` + `react-dom/client` from the
 * shell's static module map; all visuals are self-contained CSS on the
 * app's theme variables.
 */
window.__ModuleLoader__.load({
	id: "chicheng-cron",
	factory: (require) => {
		const React = require("react");
		const ReactDOM = require("react-dom/client");
		const { useState, useEffect, useRef, useMemo, useCallback } = React;
		const h = React.createElement;

		// ------------------------------------------------------------ api

		async function call(method, payload) {
			const response = await fetch(`/cron/api/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload ?? {}),
			});
			const parsed = await response.json().catch(() => null);
			if (!response.ok || parsed === null || parsed.ok !== true) {
				throw new Error(parsed?.error?.message ?? `HTTP ${response.status}`);
			}
			return parsed.value;
		}

		// ------------------------------------------------------------ copy

		function zhCopy() {
			return typeof document !== "undefined" && document.documentElement?.lang?.toLowerCase().startsWith("zh");
		}
		const t = (key) => {
			const zh = {
				trigger: "定时任务",
				triggerLabel: "打开定时任务面板",
				title: "定时任务",
				newTask: "新建任务",
				close: "关闭",
				taskName: "任务名称",
				taskType: "类型",
				typeShell: "Shell 脚本",
				typePython: "Python 脚本",
				typeNode: "Node.js 脚本",
				typeSkill: "Skill",
				typeAgent: "交给 Agent",
				cron: "Cron 表达式",
				cronPlaceholder: "如 0 9 * * *（分 时 日 月 周）；或 @every 30m",
				cronPresets: "常用：",
				every: "固定间隔（秒）",
				enabled: "启用",
				script: "脚本内容",
				scriptPlaceholder: "在此输入要执行的脚本…",
				skillPick: "选择 Skill",
				skillExtra: "附加说明（可选）",
				agentPrompt: "交给 Agent 的任务描述",
				agentPromptPlaceholder: "例如：总结 D:\\logs 目录下今天的日志，生成一份报告保存到 report.md",
				cwd: "工作目录（留空为启动目录）",
				timeout: "超时（毫秒，0 为不限）",
				save: "保存",
				delete: "删除",
				runNow: "立即执行",
				cancel: "取消",
				edit: "编辑",
				preview: "接下来将执行：",
				noTasks: "还没有任务，点击右上角“新建任务”创建一个。",
				nextRun: "下次运行",
				lastRun: "上次运行",
				lastStatus: "上次状态",
				statusOk: "成功",
				statusFailed: "失败",
				statusRunning: "运行中",
				statusTimeout: "超时",
				never: "从未",
				history: "执行历史",
				noRuns: "暂无执行记录",
				output: "输出",
				openOutput: "查看输出",
				reasonCron: "定时",
				reasonManual: "手动",
				confirmDelete: "确定删除任务“{name}”？",
				confirm: "确定",
				saving: "保存中…",
				runningNow: "正在触发执行…",
				error: "错误",
				enabledOn: "启用",
				disabledOff: "停用",
				loadingSkills: "加载技能中…",
				groupSessions: "Agent 运行会话归入「定时任务」分组",
				pushEnabled: "完成后推送通知",
				pushChannel: "推送渠道",
				pushChannelAll: "全部已启用渠道",
				pushGroup: "推送插件（chicheng-push）",
				messagingGroup: "消息平台（messaging-core）",
				pushTitle: "推送标题",
				pushTitlePlaceholder: "默认：定时任务「{name}」执行完成",
				pushContent: "推送内容",
				pushContentPlaceholder: "默认：状态：{status}（exit {exitCode}）…",
				pushPhHint: "点击下方占位符，插入到输入框光标处",
				phName: "任务名称",
				phType: "任务类型",
				phStatus: "运行状态",
				phExitCode: "退出码",
				phDuration: "耗时",
				phTime: "完成时间",
				phOutput: "运行输出",
				pushUnavailable: "未检测到推送插件（chicheng-push）或消息平台（messaging-core）：请先在“设置 → 推送插件 / 消息平台”中配置机器人，并至少与机器人对话一次（会话会自动出现在渠道列表）",
				loadingChannels: "加载推送渠道…",
				pushOk: "推送成功",
				pushFail: "推送失败",
				archivedSessionOk: "会话已归档",
				archiveOnSuccess: "成功后自动归档会话",
				groupBasic: "基本信息",
				groupPlan: "计划",
				groupExec: "执行",
				groupNotify: "通知",
				groupAdvanced: "高级",
				back: "返回",
			};
			const en = {
				trigger: "Scheduled Tasks",
				triggerLabel: "Open scheduled tasks panel",
				title: "Scheduled Tasks",
				newTask: "New Task",
				close: "Close",
				taskName: "Task name",
				taskType: "Type",
				typeShell: "Shell script",
				typePython: "Python script",
				typeNode: "Node.js script",
				typeSkill: "Skill",
				typeAgent: "Ask the agent",
				cron: "Cron expression",
				cronPlaceholder: "e.g. 0 9 * * * (min hour dom month dow); or @every 30m",
				cronPresets: "Presets: ",
				every: "Fixed interval (seconds)",
				enabled: "Enabled",
				script: "Script",
				scriptPlaceholder: "Enter the script to run…",
				skillPick: "Pick a skill",
				skillExtra: "Extra instructions (optional)",
				agentPrompt: "Task description for the agent",
				agentPromptPlaceholder: "e.g. Summarize today's logs in D:\\logs and save a report to report.md",
				cwd: "Working directory (empty = launch dir)",
				timeout: "Timeout (ms, 0 = none)",
				save: "Save",
				delete: "Delete",
				runNow: "Run now",
				cancel: "Cancel",
				edit: "Edit",
				preview: "Will run at:",
				noTasks: "No tasks yet — click “New Task” to create one.",
				nextRun: "Next run",
				lastRun: "Last run",
				lastStatus: "Last status",
				statusOk: "OK",
				statusFailed: "Failed",
				statusRunning: "Running",
				statusTimeout: "Timeout",
				never: "never",
				history: "Run history",
				noRuns: "No runs yet",
				output: "Output",
				openOutput: "View output",
				reasonCron: "scheduled",
				reasonManual: "manual",
				confirmDelete: "Delete task “{name}”?",
				confirm: "Confirm",
				saving: "Saving…",
				runningNow: "Triggering…",
				error: "Error",
				enabledOn: "Enable",
				disabledOff: "Disable",
				loadingSkills: "Loading skills…",
				groupSessions: "Group agent run sessions under “Scheduled Tasks”",
				pushEnabled: "Push on completion",
				pushChannel: "Push channel",
				pushChannelAll: "All enabled channels",
				pushGroup: "Push plugin (chicheng-push)",
				messagingGroup: "Messaging (messaging-core)",
				pushTitle: "Push title",
				pushTitlePlaceholder: "Default: Task “{name}” finished",
				pushContent: "Push content",
				pushContentPlaceholder: "Default: Status: {status} (exit {exitCode})…",
				pushPhHint: "Click a placeholder to insert it at the cursor",
				phName: "Task name",
				phType: "Task type",
				phStatus: "Status",
				phExitCode: "Exit code",
				phDuration: "Duration",
				phTime: "Finish time",
				phOutput: "Run output",
				pushUnavailable: "No push plugin (chicheng-push) or messaging platform (messaging-core) detected — configure a bot in Settings → Push / Messaging and chat with it once (the chat will appear in the channel list)",
				loadingChannels: "Loading channels…",
				pushOk: "pushed",
				pushFail: "push failed",
				archivedSessionOk: "conversation archived",
				archiveOnSuccess: "Archive the run's conversation after success",
				groupBasic: "Basics",
				groupPlan: "Schedule",
				groupExec: "Execution",
				groupNotify: "Notification",
				groupAdvanced: "Advanced",
				back: "Back",
			};
			return (zhCopy() ? zh : en)[key] ?? key;
		};

		// ------------------------------------------------------------ icons

		const svg = (path, size = 16, extra) =>
			h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				"aria-hidden": true,
				style: { flex: "none" },
				...extra,
			}, h("path", { d: path, fill: "currentColor" }));

		/** Partial-apply an SVG path onto {@link svg}: makeIcon(path)(size, extra). */
		const makeIcon = (path) => (size = 16, extra) => svg(path, size, extra);

		const iconClock = makeIcon("M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm0 1a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm-.5 2v4.207l3 1.8.5-.866-2.5-1.5V4.5h-1z");
		const iconClose = makeIcon("M8 6.586l4.293-4.293 1.414 1.414L9.414 8l4.293 4.293-1.414 1.414L8 9.414l-4.293 4.293-1.414-1.414L6.586 8 2.293 3.707l1.414-1.414L8 6.586z");
		const iconPlus = makeIcon("M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z");
		const iconPlay = makeIcon("M4 2.5l9 5.5-9 5.5v-11zm1.5 2v7l5.5-3.5-5.5-3.5z");
		const iconTrash = makeIcon("M6 1.5h4l.5.5H13v1.5H3V2h2.5l.5-.5zM4 5h8l-.6 8.1a1.5 1.5 0 0 1-1.5 1.4H6.1a1.5 1.5 0 0 1-1.5-1.4L4 5zm1.7 1.2l.6 6.3h1.5l-.4-6.3H5.7zm3.1 0l-.4 6.3h1.5l.6-6.3H8.8z");
		const iconBack = makeIcon("M11 2.3 5.3 8l5.7 5.7 1-1L7.3 8l4.7-4.7z");

		// ------------------------------------------------------------ css

		const CSS = `
.dshc-trigger{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;height:38px;
  margin:0 2px 8px;padding:8px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3f4b);
  background:var(--dsw-alias-button-elevated-fill,#1f2430);color:var(--dsw-alias-label-primary,#e6e9ef);
  border-radius:12px;font-size:14px;font-weight:500;line-height:22px;cursor:pointer;overflow:hidden;white-space:nowrap;
  width:calc(100% - 4px)}
.dshc-trigger:hover{background:var(--dsw-alias-button-floating-hover,#262c3a)}
.dshc-trigger[data-collapsed="true"]{width:36px;height:36px;margin:0 0 12px;padding:0;flex:none;align-self:flex-start;background:transparent;border-color:transparent}
.dshc-trigger[data-collapsed="true"]:hover{background:var(--dsw-alias-interactive-bg-hover,#2a3140)}
.dshc-trigger .dshc-trigger-label{overflow:hidden;text-overflow:ellipsis;max-width:160px}
.dshc-trigger[data-collapsed="true"] .dshc-trigger-label{display:none}
.dshc-mask{position:fixed;inset:0;z-index:2147482000;background:rgba(8,10,14,.55);backdrop-filter:blur(2px);
  display:flex;align-items:center;justify-content:center;padding:24px}
.dshc-panel{box-sizing:border-box;width:min(1060px,96vw);height:min(680px,92vh);display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base,#141822);color:var(--dsw-alias-label-primary,#e6e9ef);
  border:1px solid var(--dsw-alias-border-l2,#3a3f4b);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.45);
  overflow:hidden;font-size:14px}
.dshc-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1,#262b36)}
.dshc-head h2{margin:0;font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px}
.dshc-body{display:flex;flex:1;min-height:0}
.dshc-list{width:292px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,#262b36);display:flex;flex-direction:column;min-height:0}
.dshc-list-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;flex:none}
.dshc-list-scroll{flex:1;overflow:auto;padding:0 8px 8px}
.dshc-task-row{box-sizing:border-box;width:100%;text-align:left;cursor:pointer;padding:9px 10px;border-radius:10px;
  border:1px solid transparent;background:transparent;color:inherit;margin-bottom:6px;display:block}
.dshc-task-row:hover{background:var(--dsw-alias-interactive-bg-hover,#232936)}
.dshc-task-row[data-active="true"]{border-color:var(--dsw-alias-border-l2,#3a3f4b);
  background:var(--dsw-alias-interactive-bg-active,#232936)}
.dshc-task-row-name{display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:4px}
.dshc-dot{width:8px;height:8px;border-radius:50%;flex:none}
.dshc-dot[data-on="true"]{background:#3ddc84}
.dshc-dot[data-on="false"]{background:#6b7280}
.dshc-task-row-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2);display:flex;flex-direction:column;gap:2px}
.dshc-badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:99px;font-size:11px;line-height:16px;
  background:var(--dsw-alias-bg-l2,#1b202b);color:var(--dsw-alias-label-secondary,#9aa3b2)}
.dshc-badge[data-kind="ok"]{background:rgba(61,220,132,.16);color:#3ddc84}
.dshc-badge[data-kind="failed"]{background:rgba(244,93,93,.16);color:#f45d5d}
.dshc-badge[data-kind="running"]{background:rgba(99,158,254,.18);color:#639efe}
.dshc-badge[data-kind="timeout"]{background:rgba(245,158,11,.16);color:#f59e0b}
.dshc-badge[data-kind="off"]{background:rgba(245,158,11,.16);color:#f59e0b}
.dshc-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.dshc-form{flex:1;overflow:auto;padding:16px 18px}
.dshc-section{border:1px solid var(--dsw-alias-border-l2,#3a3f4b);border-radius:12px;padding:14px;margin-bottom:14px;background:var(--dsw-alias-bg-l2,#1b202b)}
.dshc-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#9aa3b2);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.dshc-field{margin-bottom:12px}
.dshc-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2);margin-bottom:5px}
.dshc-input,.dshc-select,.dshc-textarea{box-sizing:border-box;width:100%;padding:7px 10px;font-size:13px;color:inherit;
  background:var(--dsw-alias-input-fill,#10141d);border:1px solid var(--dsw-alias-border-l2,#3a3f4b);border-radius:9px;
  outline:none;font-family:inherit}
.dshc-input:focus,.dshc-select:focus,.dshc-textarea:focus{border-color:#639efe}
.dshc-textarea{resize:vertical;min-height:120px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.45}
.dshc-row{display:flex;gap:10px}
.dshc-row>*{flex:1}
.dshc-cron-wrap{display:flex;gap:8px;align-items:center}
.dshc-cron-wrap .dshc-input{flex:1}
.dshc-presets{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.dshc-preset{border:1px solid var(--dsw-alias-border-l2,#3a3f4b);background:var(--dsw-alias-bg-l2,#1b202b);
  color:var(--dsw-alias-label-secondary,#9aa3b2);font-size:11px;padding:2px 8px;border-radius:99px;cursor:pointer}
.dshc-preset:hover{border-color:#639efe;color:var(--dsw-alias-label-primary,#e6e9ef)}
.dshc-preview{margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2)}
.dshc-preview[data-error="true"]{color:#f45d5d}
.dshc-preview-list{margin-top:2px;display:flex;flex-direction:column;gap:1px}
.dshc-push-ph{margin-top:6px;margin-bottom:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2)}
.dshc-push-ph-hint{margin-bottom:5px}
.dshc-push-ph-chips{display:flex;flex-wrap:wrap;gap:6px}
.dshc-push-ph-chip{border:1px solid var(--dsw-alias-border-l2,#3a3f4b);background:var(--dsw-alias-bg-l2,#1b202b);
  color:var(--dsw-alias-label-secondary,#9aa3b2);font-size:11px;padding:2px 10px;border-radius:99px;cursor:pointer}
.dshc-push-ph-chip:hover{border-color:#639efe;color:var(--dsw-alias-label-primary,#e6e9ef)}
.dshc-check{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
.dshc-check input{accent-color:#639efe}
.dshc-actions{display:flex;gap:10px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1,#262b36);flex:none;align-items:center}
.dshc-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#3a3f4b);
  background:var(--dsw-alias-button-elevated-fill,#1f2430);color:var(--dsw-alias-label-primary,#e6e9ef);font-size:13px;cursor:pointer}
.dshc-btn:hover{background:var(--dsw-alias-button-floating-hover,#262c3a)}
.dshc-btn[data-primary="true"]{background:#3964fe;border-color:#3964fe;color:#fff}
.dshc-btn[data-primary="true"]:hover{background:#2f56e8}
.dshc-btn[data-danger="true"]{color:#f45d5d}
.dshc-btn[data-toggle="off"]{color:#f59e0b}
.dshc-btn[data-toggle="on"]{color:#3ddc84}
.dshc-btn:disabled{opacity:.5;cursor:default}
.dshc-spacer{flex:1}
.dshc-error{color:#f45d5d;font-size:12px;margin-top:8px}
.dshc-history{border-top:1px solid var(--dsw-alias-border-l1,#262b36);flex:none;max-height:236px;display:flex;flex-direction:column}
.dshc-history-head{display:flex;align-items:center;justify-content:space-between;padding:8px 18px;flex:none;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2)}
.dshc-history-scroll{overflow:auto;padding:0 18px 10px;display:flex;flex-direction:column;gap:4px}
.dshc-run-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;font-size:12px;cursor:pointer}
.dshc-run-row:hover{background:var(--dsw-alias-interactive-bg-hover,#232936)}
.dshc-run-row[data-open="true"]{background:var(--dsw-alias-interactive-bg-active,#232936)}
.dshc-run-out{border:1px solid var(--dsw-alias-border-l1,#262b36);background:#0d1017;border-radius:8px;padding:8px 10px;
  white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  line-height:1.45;max-height:140px;overflow:auto;margin:2px 0 6px;color:var(--dsw-alias-label-primary,#e6e9ef)}
.dshc-empty{color:var(--dsw-alias-label-secondary,#9aa3b2);font-size:13px;padding:24px 18px;text-align:center}
.dshc-tag-type{font-size:11px;color:var(--dsw-alias-label-secondary,#9aa3b2);border:1px solid var(--dsw-alias-border-l2,#3a3f4b);
  padding:0 6px;border-radius:6px}
.dshc-task-type-row{display:flex}

/* run output popup + history collapse */
.dshc-output-panel{width:min(760px,96vw);height:min(640px,88vh)}
.dshc-output-meta{padding:8px 18px 0;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa3b2)}
.dshc-output-body{flex:1;max-height:none;border:none;border-radius:0;margin:0;padding:14px 16px;font-size:13px}
.dshc-history-toggle{width:100%;cursor:pointer;background:none;border:none;color:inherit;font:inherit;text-align:left}
.dshc-history-toggle .dshc-chevron{transition:transform .15s var(--ds-ease-in-out);margin-left:6px}
.dshc-history-toggle .dshc-chevron[data-open="true"]{transform:rotate(180deg)}

/* ---------- mobile / narrow viewport ---------- */
@media (max-width: 720px){
  .dshc-mask{padding:0;align-items:stretch}
  .dshc-panel{width:100vw;width:100dvw;height:100vh;height:100dvh;max-height:none;border-radius:0;border-left:none;border-right:none;border-bottom:none}
  .dshc-head{min-height:52px;padding:10px 12px}
  .dshc-head h2{font-size:15px}
  .dshc-list{display:none;width:100%;border-right:none}
  .dshc-main{display:none;width:100%}
  .dshc-panel[data-view="list"] .dshc-list{display:flex}
  .dshc-panel[data-view="edit"] .dshc-main{display:flex}
  .dshc-list-head{padding:10px 14px}
  .dshc-task-row{padding:12px 12px;margin-bottom:10px;border-radius:12px}
  .dshc-task-row-meta{font-size:13px}
  .dshc-form{padding:14px 16px}
  .dshc-input,.dshc-select,.dshc-textarea{font-size:16px}
  .dshc-btn{min-height:40px;padding:8px 14px}
  .dshc-preset{font-size:12px;padding:6px 10px;min-height:30px}
  .dshc-history{max-height:42vh;border-top:none}
  .dshc-actions{flex-wrap:wrap;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
  .dshc-run-out{max-height:none}
}
`;

		const CSS_TAG = "chicheng-cron/styles";

		// ------------------------------------------------------------ components

		function EmptyState({ children }) { return h("div", { className: "dshc-empty" }, children); }

		function StatusBadge({ status, keyName }) {
			const kind = status === "ok" ? "ok" : status === "failed" ? "failed" : status === "running" ? "running" : status === "timeout" ? "timeout" : "idle";
			const label = status === "ok" ? t("statusOk") : status === "failed" ? t("statusFailed") : status === "running" ? t("statusRunning") : status === "timeout" ? t("statusTimeout") : "—";
			return h("span", { className: "dshc-badge", "data-kind": kind }, label);
		}

		function formatTime(iso) {
			if (!iso) return t("never");
			const date = new Date(iso);
			if (Number.isNaN(date.getTime())) return iso;
			return date.toLocaleString();
		}

		function formatDuration(ms) {
			if (ms === null || ms === undefined) return "";
			if (ms < 1000) return `${Math.round(ms)}ms`;
			const s = (ms / 1000).toFixed(1);
			if (ms < 60000) return `${s}s`;
			const m = Math.floor(ms / 60000);
			const rest = Math.round((ms % 60000) / 1000);
			return `${m}m${rest}s`;
		}

		/** New Session button finder: the last button with the new-session aria label (shell renders brand + New Session, New Session comes after). */
		function findNewSessionButton() {
			const selectors = 'button[aria-label="新建会话"], button[aria-label="New session"], button[aria-label="New Session"]';
			const found = document.querySelectorAll(selectors);
			if (found.length > 0) return found[found.length - 1];
			// Fallback: match by visible label text.
			const candidates = document.querySelectorAll("button");
			for (const button of candidates) {
				if (button.textContent?.includes("新会话") || button.textContent?.includes("New Session")) {
					return button;
				}
			}
			return null;
		}

		function isCollapsed(button) {
			// Rely on the shell's own "collapsed" class on the sidebar column —
			// the exact signal the shell uses to style its own controls. No width
			// heuristic: during the expand slide the column width is briefly under
			// 100px, which would keep the button in rail mode until another class
			// mutation happens (the "label appears seconds later" bug).
			let node = button?.parentElement;
			let depth = 0;
			while (node && depth < 8) {
				const cls = typeof node.className === "string" ? node.className : "";
				if (cls.includes("collapsed")) return true;
				node = node.parentElement;
				depth += 1;
			}
			return false;
		}

		function CronTrigger({ collapsed, onOpen }) {
			// Icon size matches the shell's own controls: New Session uses a
			// 14px icon in wide mode and 18px in the rail.
			return h("button", {
				type: "button",
				className: "dshc-trigger",
				"data-collapsed": String(collapsed),
				"aria-label": t("triggerLabel"),
				title: t("trigger"),
				onClick: onOpen,
			}, iconClock(collapsed ? 18 : 14), h("span", { className: "dshc-trigger-label" }, t("trigger")));
		}

		// ------------------------------------------------------------ dialog

		const CRON_PRESETS = [
			{ label: "每小时", value: "0 * * * *" },
			{ label: "每天 09:00", value: "0 9 * * *" },
			{ label: "每天 18:00", value: "0 18 * * *" },
			{ label: "每周一 09:00", value: "0 9 * * 1" },
			{ label: "每月 1 号", value: "0 0 1 * *" },
		];

		const PUSH_PLACEHOLDERS = [
			{ token: "{name}", label: t("phName") },
			{ token: "{type}", label: t("phType") },
			{ token: "{status}", label: t("phStatus") },
			{ token: "{exitCode}", label: t("phExitCode") },
			{ token: "{duration}", label: t("phDuration") },
			{ token: "{time}", label: t("phTime") },
			{ token: "{output}", label: t("phOutput") },
		];

		const TYPE_LABELS = {
			shell: t("typeShell"),
			python: t("typePython"),
			node: t("typeNode"),
			skill: t("typeSkill"),
			agent: t("typeAgent"),
		};

		function blankTask() {
			return {
				id: "",
				name: "",
				type: "shell",
				cron: "0 9 * * *",
				everySeconds: null,
				enabled: true,
				script: "",
				skill: "",
				prompt: "",
				cwd: "",
				timeoutMs: 0,
				groupSessions: true,
				pushEnabled: false,
				pushChannel: "",
				pushTitle: "",
				pushContent: "",
				archiveOnSuccess: false,
			};
		}

		function useDebounced(value, delayMs) {
			const [debounced, setDebounced] = useState(value);
			useEffect(() => {
				const timer = setTimeout(() => setDebounced(value), delayMs);
				return () => clearTimeout(timer);
			}, [value, delayMs]);
			return debounced;
		}

		function CronDialog({ onClose }) {
			const [tasks, setTasks] = useState(null);
			const [selectedId, setSelectedId] = useState("");

			// Escape closes the dialog.
			useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 720);
			useEffect(() => {
				let frame = null;
				const measure = () => { frame = null; setNarrow(window.innerWidth < 720); };
				const onResize = () => { if (frame === null) frame = requestAnimationFrame(measure); };
				window.addEventListener("resize", onResize);
				return () => {
					window.removeEventListener("resize", onResize);
					if (frame !== null) cancelAnimationFrame(frame);
				};
			}, []);
			// Lock background scroll while the dialog is open (esp. mobile).
			useEffect(() => {
				const previous = document.body.style.overflow;
				document.body.style.overflow = "hidden";
				return () => { document.body.style.overflow = previous; };
			}, []);
			const [mobileView, setMobileView] = useState("list");
			const [draft, setDraft] = useState(blankTask());
			const [skills, setSkills] = useState(null);
			const [pushChannels, setPushChannels] = useState(null);
			const [pushAvailable, setPushAvailable] = useState(false);
			const [messagingAvailable, setMessagingAvailable] = useState(false);
			const [runs, setRuns] = useState([]);
			const [openRunId, setOpenRunId] = useState(null);
			const [runOutput, setRunOutput] = useState(null);
			const [preview, setPreview] = useState(null);
			const [saving, setSaving] = useState(false);
			const [busy, setBusy] = useState(false);
			const [error, setError] = useState("");
			const [runsTick, setRunsTick] = useState(0);
			// Run history starts collapsed on every viewport; click the header to expand.
			const [historyOpen, setHistoryOpen] = useState(false);
			const selectedIdRef = useRef("");
			useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
			const previewCron = useDebounced(draft.type === "every" ? "" : draft.cron, 350);
			const previewEvery = useDebounced(draft.type === "every" ? draft.everySeconds : null, 350);

			const reload = useCallback(async (opts = {}) => {
				try {
					const data = await call("list");
					setTasks(data.tasks);
					if (opts.select !== undefined && opts.select !== null) {
						setSelectedId(opts.select);
						return;
					}
					if (opts.select === null) {
						if (selectedIdRef.current === "" && data.tasks.length > 0) setSelectedId(data.tasks[0].id);
						return;
					}
					if (!data.tasks.some((task) => task.id === selectedIdRef.current)) {
						setSelectedId(data.tasks.length > 0 ? data.tasks[0].id : "");
					}
				} catch (e) {
					setError(e.message);
				}
			}, []);

			useEffect(() => {
				reload({ select: null });
				call("skills").then((data) => setSkills(data.skills)).catch(() => setSkills([]));
				call("pushChannels").then((data) => {
					setPushChannels(data.channels ?? []);
					setPushAvailable(data.pushAvailable === true);
					setMessagingAvailable(data.messagingAvailable === true);
				}).catch(() => { setPushChannels([]); setPushAvailable(false); setMessagingAvailable(false); });
				const timer = setInterval(() => {
					reload({});
					setRunsTick((tick) => tick + 1);
				}, 3000);
				return () => clearInterval(timer);
			}, [reload]);

			// Reset the output popup only when the selected task changes (not on the
			// 3s poll), so an open popup is never yanked away mid-read.
			useEffect(() => {
				setOpenRunId(null);
				setRunOutput(null);
			}, [selectedId]);

			// load runs for the selected task (reloads when selection or runsTick changes)
			useEffect(() => {
				let cancelled = false;
				if (!selectedId) {
					setRuns([]);
					return undefined;
				}
				call("runs", { taskId: selectedId, limit: 30 })
					.then((data) => { if (!cancelled) setRuns(data.runs ?? []); })
					.catch(() => { if (!cancelled) setRuns([]); });
				return () => { cancelled = true; };
			}, [selectedId, runsTick]);

			// adopt the selected task into the draft — only when the selection itself changes,
			// so the background poll never overwrites in-progress edits.
			const lastSelRef = useRef(null);
			useEffect(() => {
				if (!tasks || !selectedId) return;
				if (lastSelRef.current === selectedId) return;
				lastSelRef.current = selectedId;
				const task = tasks.find((candidate) => candidate.id === selectedId);
				setDraft(task ? {
					id: task.id,
					name: task.name,
					type: task.type,
					cron: task.cron || "",
					everySeconds: task.everySeconds,
					enabled: task.enabled,
					script: task.script || "",
					skill: task.skill || "",
					prompt: task.prompt || "",
					cwd: task.cwd || "",
					timeoutMs: task.timeoutMs || 0,
					groupSessions: task.groupSessions !== false,
					pushEnabled: task.pushEnabled === true,
					pushChannel: task.pushChannel || "",
					pushTitle: task.pushTitle || "",
					pushContent: task.pushContent || "",
					archiveOnSuccess: task.archiveOnSuccess === true,
				} : blankTask());
			}, [tasks, selectedId]);

			// cron preview (debounced upstream)
			useEffect(() => {
				const timer = setTimeout(() => {
					call("preview", { cron: draft.type === "every" ? "" : draft.cron, everySeconds: draft.type === "every" ? draft.everySeconds : null, from: new Date().toISOString() })
						.then(setPreview)
						.catch(() => {});
				}, 60);
				return () => clearTimeout(timer);
			}, [previewCron, previewEvery, draft.type]);

			const patch = (partial) => setDraft((prev) => ({ ...prev, ...partial }));

			const pushContentRef = useRef(null);
			const insertPushToken = (token) => {
				const el = pushContentRef.current;
				const value = draft.pushContent;
				if (el) {
					const start = el.selectionStart ?? value.length;
					const end = el.selectionEnd ?? value.length;
					patch({ pushContent: value.slice(0, start) + token + value.slice(end) });
					requestAnimationFrame(() => {
						el.focus();
						el.selectionStart = el.selectionEnd = start + token.length;
					});
				} else {
					patch({ pushContent: value + token });
				}
			};

			const newTask = () => {
				setSelectedId("");
				lastSelRef.current = null;
				setDraft(blankTask());
				setError("");
				if (narrow) setMobileView("edit");
			};

			const save = async () => {
				setSaving(true);
				setError("");
				try {
					const result = await call("save", { task: draft });
					setSaving(false);
					await reload({ select: result.task.id });
				} catch (e) {
					setSaving(false);
					setError(e.message);
				}
			};

			const remove = async () => {
				if (!draft.id) return;
				if (!window.confirm(t("confirmDelete").replace("{name}", draft.name))) return;
				setBusy(true);
				try {
					await call("remove", { id: draft.id });
					setBusy(false);
					newTask();
					if (narrow) setMobileView("list");
				} catch (e) {
					setBusy(false);
					setError(e.message);
				}
			};

			const runNow = async () => {
				if (!draft.id) return;
				setBusy(true);
				setError("");
				try {
					await call("runNow", { id: draft.id });
					setBusy(false);
					setRunsTick((tick) => tick + 1);
					await reload({});
				} catch (e) {
					setBusy(false);
					setError(e.message);
				}
			};

			const toggle = async () => {
				if (!draft.id) return;
				try {
					const result = await call("toggle", { id: draft.id, enabled: !draft.enabled });
					patch({ enabled: result.enabled });
					await reload({ select: draft.id });
				} catch (e) {
					setError(e.message);
				}
			};

			const openOutput = async (run) => {
				setOpenRunId(run.runId);
				setRunOutput(null);
				try {
					const data = await call("runOutput", { runId: run.runId });
					setRunOutput(data.output);
				} catch (e) {
					setRunOutput(`(无法读取输出: ${e.message})`);
				}
			};

			const scheduleLabel = (task) => task.scheduleText || task.cron || "";

			const rows = h("div", { className: "dshc-list-scroll" },
				(tasks ?? []).map((task) => h("button", {
					key: task.id,
					type: "button",
					className: "dshc-task-row",
					"data-active": String(task.id === selectedId),
					onClick: () => { setSelectedId(task.id); if (narrow) setMobileView("edit"); },
				},
					h("div", { className: "dshc-task-row-name" },
						h("span", { className: "dshc-dot", "data-on": String(task.enabled) }),
						h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, task.name),
					),
					h("div", { className: "dshc-task-row-meta" },
						h("span", {}, `${TYPE_LABELS[task.type] ?? task.type} · ${scheduleLabel(task) || "—"}`),
						h("span", {}, `${t("nextRun")}: ${formatTime(task.nextRunAt)}`),
					),
				)),
				(tasks !== null && tasks.length === 0) && h(EmptyState, {}, t("noTasks"))
			);

			const isEvery = draft.type === "every";
			const showCronField = !isEvery;
			const previewTimes = preview?.next ?? [];
			const previewError = preview?.ok === false ? preview.error : null;

			const section = (title, fields) => h("div", { className: "dshc-section" },
				h("div", { className: "dshc-section-title" }, title),
				fields
			);

			const nameField = h("div", { className: "dshc-field" },
				h("label", { className: "dshc-label" }, t("taskName")),
				h("input", { className: "dshc-input", value: draft.name, placeholder: "my-task", onChange: (e) => patch({ name: e.target.value }) })
			);
			const typeField = h("div", { className: "dshc-field" },
				h("label", { className: "dshc-label" }, t("taskType")),
				h("select", { className: "dshc-select", value: draft.type, onChange: (e) => patch({ type: e.target.value }) },
					["shell", "python", "node", "skill", "agent"].map((type) =>
						h("option", { key: type, value: type }, TYPE_LABELS[type])))
			);
			const cronField = h("div", { className: "dshc-field" },
				h("div", { className: "dshc-cron-wrap" },
					h("div", { style: { flex: 1 } },
						h("label", { className: "dshc-label" }, isEvery ? t("every") : t("cron")),
						isEvery
							? h("input", { className: "dshc-input", type: "number", min: 1, value: draft.everySeconds ?? "", placeholder: "1800", onChange: (e) => patch({ everySeconds: e.target.value === "" ? null : Number(e.target.value) }) })
							: h("input", { className: "dshc-input", value: draft.cron, placeholder: t("cronPlaceholder"), onChange: (e) => patch({ cron: e.target.value }) })
					),
					h("div", { style: { flex: 1 } },
						h("label", { className: "dshc-label" }, t("timeout")),
						h("input", { className: "dshc-input", type: "number", min: 0, step: 1000, value: draft.timeoutMs ?? 0, onChange: (e) => patch({ timeoutMs: Number(e.target.value) || 0 }) })
					)
				),
				showCronField && h("div", { className: "dshc-presets" },
					h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary,#9aa3b2)", alignSelf: "center" } }, t("cronPresets")),
					CRON_PRESETS.map((preset) => h("button", { key: preset.value, type: "button", className: "dshc-preset", onClick: () => patch({ cron: preset.value }) }, preset.label))
				),
				(!isEvery) && previewError && h("div", { className: "dshc-preview", "data-error": "true" }, `${t("error")}: ${previewError}`),
				(!isEvery) && !previewError && previewTimes.length > 0 && h("div", { className: "dshc-preview" },
					t("preview"),
					h("div", { className: "dshc-preview-list" },
						previewTimes.slice(0, 4).map((iso) => h("span", { key: iso }, formatTime(iso)))
					)
				),
			);
			const enabledField = h("div", { className: "dshc-field" },
				h("div", { style: { display: "flex", gap: 12, alignItems: "center" } },
					h("label", { className: "dshc-check" },
						h("input", { type: "checkbox", checked: draft.enabled, onChange: (e) => patch({ enabled: e.target.checked }) }),
						h("span", {}, t("enabled")),
					),
					draft.id !== "" && h("span", { className: "dshc-badge", "data-kind": draft.enabled ? "ok" : "off" }, draft.enabled ? t("enabledOn") : t("disabledOff"))
				)
			);

			const execFields = [];
			const notifyFields = [];
			const advancedFields = [];

			if (draft.type === "shell" || draft.type === "python" || draft.type === "node") {
				execFields.push(
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("script")),
						h("textarea", { className: "dshc-textarea", rows: 12, value: draft.script, placeholder: t("scriptPlaceholder"), spellCheck: false, onChange: (e) => patch({ script: e.target.value }) })
					),
				);
			}

			if (draft.type === "skill") {
				execFields.push(
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("skillPick")),
						skills === null
							? h(EmptyState, {}, t("loadingSkills"))
							: h("select", { className: "dshc-select", value: draft.skill, onChange: (e) => patch({ skill: e.target.value }) },
								h("option", { value: "" }, "—"),
								skills.map((skill) => h("option", { key: skill.name, value: skill.name }, `${skill.name}${skill.description ? ` — ${skill.description}` : ""}`))
							)
					),
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("skillExtra")),
						h("textarea", { className: "dshc-textarea", rows: 4, value: draft.prompt, placeholder: t("agentPromptPlaceholder"), onChange: (e) => patch({ prompt: e.target.value }) })
					),
				);
			}

			if (draft.type === "agent") {
				execFields.push(
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("agentPrompt")),
						h("textarea", { className: "dshc-textarea", rows: 10, value: draft.prompt, placeholder: t("agentPromptPlaceholder"), onChange: (e) => patch({ prompt: e.target.value }) })
					),
				);
			}

			if (draft.type === "agent" || draft.type === "skill") {
				execFields.push(
					h("div", { className: "dshc-field" },
						h("div", { style: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" } },
							h("label", { className: "dshc-check" },
								h("input", { type: "checkbox", checked: draft.groupSessions !== false, onChange: (e) => patch({ groupSessions: e.target.checked }) }),
								h("span", {}, t("groupSessions")),
							),
							h("label", { className: "dshc-check" },
								h("input", { type: "checkbox", checked: draft.archiveOnSuccess, onChange: (e) => patch({ archiveOnSuccess: e.target.checked }) }),
								h("span", {}, t("archiveOnSuccess")),
							),
						),
					),
				);
			}

			notifyFields.push(
				h("div", { className: "dshc-field" },
					h("div", { style: { display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" } },
						h("label", { className: "dshc-check" },
							h("input", { type: "checkbox", checked: draft.pushEnabled, onChange: (e) => patch({ pushEnabled: e.target.checked }) }),
							h("span", {}, t("pushEnabled")),
						),
					),
				),
			);
			if (draft.pushEnabled) {
				notifyFields.push(
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("pushChannel")),
						pushChannels === null
							? h(EmptyState, {}, t("loadingChannels"))
							: h("select", { className: "dshc-select", value: draft.pushChannel, onChange: (e) => patch({ pushChannel: e.target.value }) },
								h("option", { value: "" }, t("pushChannelAll")),
								(() => {
									const pushList = pushChannels.filter((channel) => channel.source !== "messaging" && channel.enabled !== false);
									const msgList = pushChannels.filter((channel) => channel.source === "messaging" && channel.enabled !== false);
									return [
										pushList.length > 0 && h("optgroup", { key: "push", label: t("pushGroup") },
											pushList.map((channel) => h("option", { key: channel.id, value: channel.id }, `${channel.name}（${channel.type}）`))
										),
										msgList.length > 0 && h("optgroup", { key: "msg", label: t("messagingGroup") },
											msgList.map((channel) => h("option", { key: channel.id, value: channel.id }, channel.name))
										),
									];
								})()
							),
						!pushAvailable && !messagingAvailable && pushChannels !== null && h("div", { className: "dshc-preview", "data-error": "true" }, t("pushUnavailable")),
					),
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("pushTitle")),
						h("input", { className: "dshc-input", value: draft.pushTitle, placeholder: t("pushTitlePlaceholder"), onChange: (e) => patch({ pushTitle: e.target.value }) })
					),
					h("div", { className: "dshc-field" },
						h("label", { className: "dshc-label" }, t("pushContent")),
						h("textarea", { ref: pushContentRef, className: "dshc-textarea", rows: 4, value: draft.pushContent, placeholder: t("pushContentPlaceholder"), onChange: (e) => patch({ pushContent: e.target.value }) })
					),
					h("div", { className: "dshc-push-ph" },
						h("div", { className: "dshc-push-ph-hint" }, t("pushPhHint")),
						h("div", { className: "dshc-push-ph-chips" },
							PUSH_PLACEHOLDERS.map((p) => h("button", { key: p.token, type: "button", className: "dshc-push-ph-chip", title: p.token, onClick: () => insertPushToken(p.token) }, p.label))
						)
					),
				);
			}

			advancedFields.push(
				h("div", { className: "dshc-field" },
					h("label", { className: "dshc-label" }, t("cwd")),
					h("input", { className: "dshc-input", value: draft.cwd, placeholder: "D:\\workspace", onChange: (e) => patch({ cwd: e.target.value }) })
				),
			);

			const formFields = [
				section(t("groupBasic"), [nameField, typeField, enabledField]),
				section(t("groupPlan"), [cronField]),
				execFields.length > 0 && section(t("groupExec"), execFields),
				section(t("groupNotify"), notifyFields),
				section(t("groupAdvanced"), advancedFields),
			];

			const selected = (tasks ?? []).find((task) => task.id === selectedId) ?? null;

			const historyBlock = h("div", { className: "dshc-history" },
				h("button", { type: "button", className: "dshc-history-head dshc-history-toggle", onClick: () => setHistoryOpen((open) => !open), "aria-expanded": String(historyOpen) },
					h("span", {}, t("history")),
					h("span", {}, runs.length > 0 ? `${runs.length}` : ""),
					h("span", { className: "dshc-chevron", "data-open": String(historyOpen) }, "▾")
				),
				historyOpen && h("div", { className: "dshc-history-scroll" },
					runs.length === 0 && h(EmptyState, {}, t("noRuns")),
					runs.map((run) => h("div", { key: run.runId },
						h("div", {
							className: "dshc-run-row",
							onClick: () => openOutput(run),
							title: t("openOutput"),
						},
							h("span", {}, run.reason === "manual" ? t("reasonManual") : t("reasonCron")),
							h("span", {}, formatTime(run.startedAt)),
							h(StatusBadge, { status: run.status }),
							h("span", {}, formatDuration(run.durationMs)),
							h("span", { style: { color: "var(--dsw-alias-label-secondary,#9aa3b2)" } }, `exit ${run.exitCode ?? "—"}`),
							h("span", {}, `${(run.outputLength ?? 0) / 1024 > 1 ? `${(run.outputLength / 1024).toFixed(1)}KB` : `${run.outputLength ?? 0}B`}`),
							run.pushResult && h("span", { className: "dshc-badge", "data-kind": run.pushResult.ok ? "ok" : "failed" }, run.pushResult.ok ? t("pushOk") : t("pushFail")),
							run.archivedSession && h("span", { className: "dshc-badge", "data-kind": "ok" }, t("archivedSessionOk"))
						)
					))
				)
			);

			return h(React.Fragment, null,
				h("div", { className: "dshc-mask", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
				h("div", { className: "dshc-panel", role: "dialog", "aria-modal": "true", "aria-label": t("title"), "data-view": narrow ? mobileView : "wide" },
					h("div", { className: "dshc-head" },
						narrow && mobileView === "edit" && h("button", { type: "button", className: "dshc-btn", onClick: () => setMobileView("list"), "aria-label": t("back") }, iconBack(16)),
						h("h2", {}, iconClock(18), t("title")),
						h("button", { type: "button", className: "dshc-btn", onClick: onClose, "aria-label": t("close") }, iconClose(14))
					),
					h("div", { className: "dshc-body" },
						h("div", { className: "dshc-list" },
							h("div", { className: "dshc-list-head" },
								h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary,#9aa3b2)" } }, `${tasks === null ? "…" : tasks.length} tasks`),
								h("button", { type: "button", className: "dshc-btn", onClick: newTask }, iconPlus(14), t("newTask"))
							),
							rows
						),
						h("div", { className: "dshc-main" },
							h("div", { className: "dshc-form" },
								selected !== null && h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } },
									h("span", { style: { fontWeight: 600, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis" } }, draft.name || "—"),
									h("span", { className: "dshc-tag-type" }, TYPE_LABELS[draft.type] ?? draft.type),
								),
								formFields,
								error !== "" && h("div", { className: "dshc-error" }, `${t("error")}: ${error}`)
							),
							historyBlock,
							h("div", { className: "dshc-actions" },
								draft.id !== "" && h("button", { type: "button", className: "dshc-btn", onClick: runNow, disabled: busy }, iconPlay(14), t("runNow")),
								draft.id !== "" && h("button", { type: "button", className: "dshc-btn", "data-toggle": draft.enabled ? "off" : "on", onClick: toggle, disabled: saving }, draft.enabled ? t("disabledOff") : t("enabledOn")),
								h("span", { className: "dshc-spacer" }),
								draft.id !== "" && h("button", { type: "button", className: "dshc-btn", "data-danger": "true", onClick: remove, disabled: busy || saving }, iconTrash(14), t("delete")),
								h("button", { type: "button", className: "dshc-btn", "data-primary": "true", onClick: save, disabled: saving || busy }, saving ? t("saving") : t("save"))
							)
						)
					)
				)
				),
				openRunId !== null && h(RunOutputDialog, {
					run: runs.find((run) => run.runId === openRunId) ?? null,
					output: runOutput,
					onClose: () => { setOpenRunId(null); setRunOutput(null); },
				})
			);
		}

		function RunOutputDialog({ run, output, onClose }) {
			useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const meta = run
				? `${formatTime(run.startedAt)} · ${run.reason === "manual" ? t("reasonManual") : t("reasonCron")} · exit ${run.exitCode ?? "—"}`
				: "";
			return h("div", { className: "dshc-mask", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
				h("div", { className: "dshc-panel dshc-output-panel", role: "dialog", "aria-modal": "true", "aria-label": t("output") },
					h("div", { className: "dshc-head" },
						h("h2", {}, t("output")),
						h("button", { type: "button", className: "dshc-btn", onClick: onClose, "aria-label": t("close") }, iconClose(14))
					),
					meta !== "" && h("div", { className: "dshc-output-meta" }, meta),
					h("div", { className: "dshc-run-out dshc-output-body" }, output ?? "…")
				)
			);
		}

		// ------------------------------------------------------------ apply

		const inject = [];

		function apply(ctx) {
			// CSS (tag-guarded, same pattern as first-party client plugins)
			if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "chicheng-cron";
				tag.dataset.pluginCss = CSS_TAG;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}

			ctx.effect(() => {
				let disposed = false;
				let host = null;
				let root = null;
				let probeTimer = null;
				let collapseObserver = null;
				let button = null;
				let dialogRoot = null;

				const teardown = () => {
					disposed = true;
					if (probeTimer !== null) clearInterval(probeTimer);
					if (collapseObserver !== null) {
						collapseObserver.disconnect();
						collapseObserver = null;
					}
					if (root !== null) {
						root.unmount();
						root = null;
					}
					if (dialogRoot !== null) {
						dialogRoot.unmount();
						dialogRoot = null;
					}
					if (host !== null && host.parentNode !== null) host.parentNode.removeChild(host);
					host = null;
					button = null;
				};

				const openDialog = () => {
					if (disposed) return;
					if (dialogRoot === null) {
						const wrap = document.createElement("div");
						wrap.setAttribute("data-dsh-cron-dialog", "");
						document.body.appendChild(wrap);
						dialogRoot = ReactDOM.createRoot(wrap);
					}
					dialogRoot.render(h(CronDialog, { onClose: () => {
						if (dialogRoot !== null) {
							dialogRoot.unmount();
							dialogRoot = null;
							// Remove the wrapper element left behind by unmount().
							const leftover = document.querySelector('[data-dsh-cron-dialog]');
							if (leftover) leftover.remove();
						}
					} }));
				};

				const mountTrigger = () => {
					button = findNewSessionButton();
					if (button === null || document.querySelector('[data-dsh-cron-host]') !== null) return;
					host = document.createElement("div");
					host.setAttribute("data-dsh-cron-host", "");
					button.parentNode.insertBefore(host, button.nextSibling);
					root = ReactDOM.createRoot(host);
					let collapsed = isCollapsed(button);
					const render = () => {
						if (root !== null) {
							root.render(h(CronTrigger, { collapsed, onOpen: openDialog }));
						}
					};
					render();
					// Track the shell's wide/rail flip by watching class changes on the
					// sidebar column itself (MutationObserver, not polling), so the label
					// shows together with the shell's other controls when expanding —
					// no icon-then-label flash.
					const rootEl = host?.parentElement;
					if (rootEl !== null && rootEl !== undefined && typeof MutationObserver !== "undefined") {
						collapseObserver = new MutationObserver(() => {
							if (disposed) return;
							if (!document.contains(button)) return;
							const next = isCollapsed(button);
							if (next !== collapsed) {
								collapsed = next;
								render();
							}
						});
						// Watch every ancestor's class attribute so the shell's
						// wide/rail flip is seen regardless of DOM structure.
						let node = rootEl;
						let depth = 0;
						while (node && depth < 8) {
							collapseObserver.observe(node, { attributes: true, attributeFilter: ["class"] });
							node = node.parentElement;
							depth += 1;
						}
					}
				};

				probeTimer = setInterval(() => {
					if (button !== null) return;
					if (disposed) return;
					mountTrigger();
				}, 400);

				return teardown;
			}, "chicheng-cron: sidebar mount");
		}

		return { apply, inject };
	}
});