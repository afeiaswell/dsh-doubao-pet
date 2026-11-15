# 生图接口（给 DSH / Agent 用）

本插件**不在界面里提供生图表单**。需要出图时，按下面的接口调用即可。

## 1. 先看环境

工具 `doubao_pet_status`（只读）返回：

- `arkcli`：Ark CLI 是否安装、版本
- `doubao`：豆包客户端是否安装、是否在运行、下载页
- `ark.keyConfigured` / `ark.gateway.mode`：有没有配置火山引擎 Key、走套餐还是按量
- `stats.today`：今天两个渠道各出了多少张、花了多少钱
- `characters`：可切换的角色（与生图无关，界面用）

如果没有配置 Key，`doubao_generate_image` 会直接报错，需要用户在控制台「火山引擎生图」页填 Key 并验证。

## 2. 出图

工具 `doubao_generate_image`：

| 参数 | 类型 | 说明 |
|---|---|---|
| `prompt` | string，必填 | 提示词。中英都行，建议写清风格、构图、背景 |
| `route` | string | `ark`（火山引擎 API）/ `local`（本机豆包工作模式）。**省略时按插件里的「生图偏好」**（`_prefs.json`，默认 ark） |
| `size` | string | 仅 ark：`2K`（默认）/ `4K` / `1024x1024` 这类精确尺寸 |
| `count` | number | 1–4，默认 1 |
| `model` | string | 仅 ark。**省略或 `"auto"`** 就由插件在你套餐真正可用的模型里挑，按「模型偏好」排序（见下）；传确切 id 则强制使用，不在套餐里会直接报错并列出可用项 |
| `prefer` | string | 仅 ark。按次覆盖模型偏好：`"fast"`（便宜 / 快）或 `"quality"`（贵 / 好）。`model` 给了确切 id 时忽略 |

两条路线的差别：

| | `route: "ark"` | `route: "local"` |
|---|---|---|
| 通道 | 火山引擎方舟 API | 本机豆包客户端工作模式（子进程调 `art/tools/imgforge`） |
| 速度 | 3–15 秒 | 1–3 分钟（客户端要跑任务、读本地文件） |
| 花费 | 套餐内 ¥0 / 按量按张计费 | ¥0（订阅额度） |
| 前置 | 已配置 Ark API Key | 豆包客户端已开且带调试端口 |
| 副作用 | 无 | 会在豆包「大肥鱼工作台」项目里新建对话 |

返回：

```json
{
  "ok": true,
  "base": "https://ark.cn-beijing.volces.com/api/plan/v3",
  "mode": "plan",
  "model": "doubao-seedream-5-0-flash-260915",
  "size": "2K",
  "files": [
    { "name": "doubao_pet_1794723924872_0.jpg", "bytes": 405158,
      "path": "D:\\...\\art\\ai\\doubao_plugin\\doubao_pet_1794723924872_0.jpg",
      "url": "/doubao-pet/out/doubao_pet_1794723924872_0.jpg" }
  ],
  "errors": []
}
```

- 落盘目录：`<工作区>/art/ai/doubao_plugin`
- `url` 是 DSH Web 的预览地址（页面可直接 `<img src>`）
- 每次成功调用都会写进插件统计（悬浮气泡里的"今日资费"）

## 3. 可选：HTTP 直调

界面用的是同一套路由，也可以在宿主里直接调：

```bash
# 状态
curl http://127.0.0.1:3080/doubao-pet/api/status

# 出图（同源 POST，需要 Content-Type: application/json）
curl -X POST http://127.0.0.1:3080/doubao-pet/api/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"青花瓷松鼠武将，纯色背景","size":"2K","count":1}'
```

## 4. 模型选择与费用

**让插件自己挑（推荐）**：不传 `model`，或传 `"auto"`。插件从 `doubao_pet_status` 的
`ark.models`（= 你套餐里真正可达的模型）里按「模型偏好」排序尝试（`fast` = 便宜的在前，
`quality` = 贵的在前），遇到 `404 UnsupportedModel` 自动换下一个，返回值里
`autoSelected: true`、`preference`、`tried` 记录尝试序列。偏好可在控制台「外观设置」里改，
也能按次用 `prefer` 覆盖。

**指定模型**：传确切 id。不在套餐里会立刻报错，错误信息里带可用列表，例如：

```
模型 doubao-seedream-5-5-261028 不在当前套餐的可用列表里。
可用：doubao-seedream-5-0-flash-260915、doubao-seedream-5-0-pro-260628
```

查询当前可用模型：`doubao_pet_status` → `ark.models`（id + 2K 单价），或在控制台
「火山引擎生图」页看模型列表（带可达状态与单价）。

- 模型 id 必须带日期后缀，例如 `doubao-seedream-5-0-flash-260915`
- 不在套餐里会返回 `404 UnsupportedModel`，额度用尽返回 `429 SetLimitExceeded`
- 单价（元/张，2K）：5.0 flash `0.12`、5.0 pro `0.30`（4K `0.60`）、5.5 `0.13`、4.5 `0.25`、4.0 `0.20`
- 套餐网关下现金支出为 0，插件统计里按官方单价折算成"折算值"

## 5. 额度与开销

想看用量：`doubao_pet_status` 返回的 `usage` 字段。

- **火山引擎**：`usage.volcengine.items[].periods[]`，每段有 `label`（5h / weekly / monthly）、`used`、`total`、`percent`、`resetAt`。
  数据来自 `arkcli usage plan`（需 `arkcli auth login`），和控制台「用量」那三行一致。
- **豆包本地**：`usage.doubao`，形如
  `{ available: true, used: 347, total: 24000, percent: 1.45, plan: "加强套餐", price: "CN¥200.00", renewAt }`。
  做法是在客户端页面上下文里调它自己的额度接口（自带登录态），静默、不弹窗、约 235ms；
  客户端没开调试端口时 `available: false` 并给出 `reason`。
- **今日出图与花费**：`stats.today.local` / `stats.today.ark`（`count`、`cash`、`list`）。

## 6. 豆包本地出图

`doubao_generate_image` 传 `route: "local"` 即可，内部调用工作区的
`art/tools/imgforge/cli.js doubao work`：在豆包「大肥鱼工作台」项目里新建对话、走工作模式出图、把文件落到
`<outDir>`。需要客户端已开启调试端口，否则会返回明确错误。
