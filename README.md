# dsh-doubao-pet

<p align="center">
  <img src="docs/pet.png" alt="豆包桌宠" width="150">
</p>

Web 界面角落的**豆包桌宠**：悬浮看开销与额度、点击捏一下、可拖动可缩放可贴边。
生图有两条路线——**本机豆包工作模式**和**火山引擎方舟 API**——都通过 Agent 工具 + HTTP 接口暴露给 DSH。

## 形象与交互

| 状态 | 触发 | 表现 |
|---|---|---|
| 默认 | — | `豆包.png` / `sdniang.png` |
| 悬浮 | 鼠标移上去 | 微笑图 + **资费气泡**（不缩放、不加边框，避免出现视觉间隙） |
| 点击 | 单击 / 回车 / 空格 | 眯眼微笑图 + 捏捏形变 |
| 设置 | 悬浮后点形象**外侧**的蓝色调节按钮 | 打开控制台 |

- 可切换角色：**豆包**、**sd娘**（各自三态立绘）
- 素材管线：`tools/prepare-assets.ps1`（缩 384² + 白底转透明）→ `tools/trim-assets.ps1`（按三张图 alpha 并集紧贴裁剪，
  两角色各自裁剪，三态共用同一矩形所以换表情不跳位）
- 容器按立绘自身宽高比显示（宽高比由宿主读 PNG 头实时给出），不是正方形居中，所以四边能真正贴齐

### 位置 / 大小 / 贴边

- 拖动移动，超过 4px 才算拖拽（不会误触捏捏）
- 拖到离边缘 28px 内松手 → 自动贴齐（两轴独立，可贴角落），边缘留白 0
- 右下角把手拖拽缩放 48–240px
- 位置、大小、角色、吸附开关都记在 `localStorage`（键 `dsh-doubao-pet:ui:v2`）

## 控制台（三个页签）

**豆包本地生图**
- 一行状态栏：豆包客户端是否安装 / **是否在运行**（真读进程列表，不看窗口标题）
- 未安装 → 「安装」按钮直接打开豆包下载页
- 就绪 → 显示客户端额度 + 今日/累计出图开销，并有「读取豆包额度」按钮（强制重读客户端额度）

**火山引擎生图**
- 一行状态栏：Ark CLI 版本、是否已配置 Key
- 没装 Ark CLI → 「部署 Ark CLI」（`npm i -g @volcengine/ark-cli@latest`，需确认）
- 输入 `ark-…` Key → 「验证」：判定网关（套餐 `/api/plan/v3` / 按量 `/api/v3`）、探测套餐里真正能调的模型及其单价，
  并**弹出验证结果卡片**（Key 尾号、计费网关、可用模型数、套餐档位、今日消耗）
- **验证结果会落盘缓存**（`<outDir>/_ark_cache.json`）：下次打开面板直接显示模型和单价，不再重新探测；
  想看实时状态就点「重新探测」
- 没有 Key → 「开通」按钮直达
  `https://ark.volcengine.com/region:cn-beijing/subscription/agent-plan`
- 「查套餐」走 Ark CLI（需先在终端 `arkcli auth login`）

**外观设置**
- 角色切换（豆包 / sd娘）
- 拖动自动贴边开关
- 形象大小滑杆、放大/缩小、复位位置与大小

## 资费气泡

鼠标悬浮形象时显示（不打开控制台）：

```
今日消耗
豆包本地    6 张 · ¥0
火山引擎    5 张 · ¥0.78(折算)

额度
火山 5 小时  0/10000     0%
火山 本周    0/35000     0%
火山 本月    510/100000  0.51%
豆包额度     347/24000   1.45%
今日合计     11 张
```

- **火山额度**来自 `arkcli usage plan`，与控制台「用量」三行一致（5h / 本周 / 本月，含重置时间 tooltip）
- **豆包额度**：客户端没有对外 API。插件只会**静默**尝试（扫已加载页面的 DOM / localStorage，1.8s 上限，
  不点菜单、不弹设置、不闪窗口）；实测本机 2.35.12 仍读不到——额度在设置弹窗里，不进入可读 DOM。
  所以「豆包本地生图」页提供**手动填写「已用 / 上限」+ 记住**，填一次持久保存在 localStorage，气泡照常显示比例
- **开销**：本地读工作区 `art/cost/ledger.jsonl`，火山读插件 `_stats.json`；套餐模式现金记 0、另记折算值

## 生图接口（界面不再提供表单）

- 工具 `doubao_generate_image` —— `{ prompt, route?, size?, count?, model? }`
  - `route: "ark"`（默认）走火山引擎方舟 API
  - `route: "local"` 走本机豆包客户端工作模式（子进程调 `art/tools/imgforge`，¥0、慢、会在豆包项目里建对话）
- 工具 `doubao_pet_status` —— 环境 + 今日开销 + **额度用量**（只读）
- HTTP：`POST /doubao-pet/api/generate`、`GET /doubao-pet/api/status`、`GET /doubao-pet/api/usage`
- 文档：[`docs/IMAGE_GEN.md`](docs/IMAGE_GEN.md)（DSH 需要图时先读它）

## 安装

```powershell
dsh plugin --profile web add link:D:\_\文档\三国弹射物语\plugins\dsh-doubao-pet
```

## 配置项（bundle 行 config，可选）

| 键 | 默认 | 说明 |
|---|---|---|
| `outDir` | `<工作区>/art/ai/doubao_plugin` | 生图落盘 + 统计文件目录 |
| `model` | `doubao-seedream-5-0-flash-260915` | 默认生图模型 |
| `size` | `2K` | 默认尺寸 |

API Key 只存在于 credentials（记录键 `DOUBAO_ARK_API_KEY`），不写配置文件、不进日志。

## 缓存与性能

面板打开不再被额度查询拖慢：**状态与额度拆成两个接口**。

| 接口 | 内容 | 耗时 |
|---|---|---|
| `GET /api/status` | 环境、角色、今日统计、上次额度缓存、生图偏好 | 冷 730ms / 热 3–5ms（环境探测有 15s 内存 TTL） |
| `GET /api/usage` | 火山 `arkcli usage plan` + 豆包静默扫描（并发） | 首次 1.8s，之后 5 分钟内 **3ms**（磁盘缓存） |
| `GET /api/prefs` / `POST /api/prefs` | 生图偏好（ark / local） | <5ms |

额度结果落盘到 `<outDir>/_usage_cache.json`，重启后仍能先显示上次值再后台刷新。

## 生图偏好

「外观设置」页可选 **生图偏好**：火山引擎 API / 豆包本地工作模式，写入 `<outDir>/_prefs.json`。
调用 `doubao_generate_image` 时**没显式给 `route`** 就按这个偏好走；给了 `route` 以显式为准。


| 缓存 | 位置 | 内容 |
|---|---|---|
| API Key | DSH credentials | 持久，重启不丢 |
| 验证结果 | `<outDir>/_ark_cache.json` | 网关、模式、模型清单（含可达性/单价）、可用模型、套餐、验证时间 |
| 环境探测 | 内存 15s | arkcli 版本、豆包是否运行（避免每次打开都 spawn 一次 arkcli） |
| 出图统计 | `<outDir>/_stats.json` | 按天累计张数与现金/折算金额 |

缓存按 Key 指纹（长度 + 末 6 位）校验：换 Key 会自动失效并重新探测。

## 已知边界

- **额度**：方舟数据面 API 不返回额度，只能得到逐模型可达性和 `429` 状态；套餐档位要用 Ark CLI（控制面）。
- 本地豆包只做**探测与统计**，不驱动客户端出图（驱动方式见工作区 `art/tools/imgforge`）。
- 角色宽高比随素材变化，宿主实时读 PNG 头，不需要手动改常数。
