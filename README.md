# chicheng-cron

一个用于 DeepSeek Harness Web（dsh web）的定时任务插件。

- 在左侧栏 **“新会话”** 按钮正下方新增一个 **“定时任务”** 入口按钮
- 点击打开管理面板，自主创建/编辑/启停/删除定时任务，也可“立即执行”
- 任务类型支持：
  - **Shell 脚本**（Windows 走 `cmd.exe`，其他平台走 `/bin/sh`）
  - **Python 脚本**（自动探测 `python` / `py` / `python3`）
  - **Node.js 脚本**（当前的 Node 运行时执行）
  - **Skill**（选择已安装的 skill，插件会把 skill 完整说明注入给 Agent 执行）
  - **交给 Agent**（自由提示词，由 headless dsh Agent 完成任何任务）
- cron 表达式：标准 5/6 字段（秒 分 时 日 月 周），支持 `*`、`*/n`、`a-b`、`a-b/n`、列表 `a,b`、月份/星期英文缩写，以及 `@hourly`、`@daily`、`@weekly`、`@monthly`、`@yearly` 和 `@every <n>s|m|h|d` 固定间隔
- 执行历史：每次运行记录时间、原因（定时/手动）、退出码、耗时、输出（上限 512KB），可在面板中查看
- 任务与历史持久化在 `$DSH_HOME/cron/store.json`，运行输出在 `$DSH_HOME/cron/runs/`
- 计划在本地时间计算；重启 web 后任务自动恢复调度

## 安装

```sh
dsh plugin --profile web add file:/full/path/to/chicheng-cron
```

安装后重启 `dsh web` 即可生效（左侧栏出现“定时任务”按钮）。

## 结构

| 文件 | 作用 |
|---|---|
| `lib/index.js` | 宿主端：cron 引擎、任务执行器、持久化、`/cron/api/*` 路由 |
| `lib/client.js` | 浏览器端：侧栏按钮 + 管理面板（仅依赖 shell 内置 react） |
| `cordis.patch.yml` | profile loader 挂载声明 |

API 路由（全部经浏览器同源校验）：`list`、`save`、`remove`、`toggle`、`runNow`、`preview`、`runs`、`runOutput`、`skills`。

## 注意

- Agent/Skill 任务通过 `dsh --profile headless "<prompt>"` 方式执行，需要本机可用的大模型配置（与 web 共用 `$DSH_HOME/settings.yaml`）。
- 任务启用后到点由宿主进程触发；如果 web 应用当时未运行，错过的时间点不会补跑。