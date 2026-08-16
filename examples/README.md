# 示例任务配置

以下 JSON 可直接粘贴到定时任务面板「新建任务」的对应字段中，或作为参考。

## 1. 天气播报（交给 Agent + 推送）

`examples/weather-agent-task.json`：每天 07:30 查询北京天气并推送到已配置的推送渠道/消息平台会话。推送内容留空即自动附带 Agent 的回答。

## 2. 磁盘清理脚本（Shell）

`examples/disk-cleanup-task.json`：每周末 03:00 执行 PowerShell 清理临时文件，失败时同样推送通知。

## 3. 推送模板占位符

| 占位符 | 含义 |
|---|---|
| `{name}` | 任务名称 |
| `{type}` | 任务类型（shell/python/node/skill/agent） |
| `{status}` | 运行状态（完成/失败/超时/运行中） |
| `{exitCode}` | 退出码 |
| `{duration}` | 耗时 |
| `{time}` | 完成时间 |
| `{output}` | 运行输出（Agent 任务的最终回答，前 800 字） |
