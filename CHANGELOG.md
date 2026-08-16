# Changelog

## 0.1.1 — 2026-08-16

- `feat`: messaging-core 渠道在 `/messaging/status` HTTP 不可用时的进程内兜底（报告已连接平台）
- `fix(sidebar)`: 收缩态图标对齐 Shell 规格（rail 18px / wide 14px）
- `fix(sidebar)`: 移除宽度启发式，展开时按钮与「新对话」同步呈现（不再延迟数秒）
- `feat(ui)`: 执行历史默认收起

## 0.1.0 — 2026-08-16

- 侧栏「定时任务」入口（位于「新会话」下方），展开/收缩态与原生控件一致
- 任务类型：Shell / Python / Node 脚本、Skill、交给 Agent（headless dsh）
- cron 表达式：5/6 字段、`*/n`、`a-b`、列表、月份/星期缩写、`@hourly`…`@yearly`、`@every <n>s|m|h|d`
- 任务管理：新建/编辑/启停/删除/立即执行，下次执行时间实时预览
- 执行历史：状态、退出码、耗时、输出弹窗查看
- 推送通知：chicheng-push 渠道（全部/指定渠道）、messaging-core 消息平台会话；标题/内容模板占位符 `{name} {type} {status} {exitCode} {duration} {time} {output}`
- Agent/Skill 会话归入「定时任务」工作区；成功后自动归档会话（可选）
- 持久化 `$DSH_HOME/cron/`，重启自动恢复调度；移动端适配
