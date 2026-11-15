# 上架 DSH 插件市场

## 为什么 GitHub 上有仓库、市场里却看不到

`dshmarket` 不扫 GitHub，它读的是一份人工目录（写死在 `dshmarket/lib/regions.js`）：

```
CATALOG_OFFICIAL = 'https://awesome-dsh-plugin.com/plugins.json'
CATALOG_PACKAGE  = 'dsh-plugin-catalog'      // 国内镜像回退
```

目录本体在 **`awesome-dsh-plugin/awesome-dsh-plugin`** 仓库：`data/plugins/*.yml`，一个插件一个文件。
投稿 = 往那里提一个 PR 加一个 YAML 文件。合并后网站自动重建，市场就出现了。

## 收录规则与本次状态

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `{"bundle":{"patch":"./cordis.patch.yml"}}` |
| 根目录 `cordis.patch.yml` | ✅ |
| 真实可用的代码（非占位） | ✅ |
| 描述属实、不带营销词 | ✅ |
| 仓库创建满 **1 天**（CI 自动查） | ⏳ 仓库建于 2026-11-15 18:05，**2026-11-16 18:05** 后达标 |
| 仓库加 `dsh-plugin` topic | ❌ 待加（网页：About 右侧齿轮 → Topics） |
| 位图图标（可选） | ✅ `assets/icon-180.png`（SVG 会被拒） |
| `screenshots.json`（可选） | ✅ 指向 `docs/screenshot.png` |
| 发布 npm（可选） | ⏸ 不影响收录，只影响是否显示下载量 |

## 待提交的条目

文件名：`data/plugins/afeiaswell__dsh-doubao-pet.yml`

```yaml
url: https://github.com/afeiaswell/dsh-doubao-pet
name: afeiaswell/dsh-doubao-pet
category: ui
description:
  en: A draggable Doubao or SD-chan mascot in the corner of the web shell, with a hover card showing today's image spend and the quota usage of both the Doubao desktop client and the Volcengine Ark plan; it also registers an Agent tool that generates images through the local Doubao work mode or the Volcengine Ark API.
  zh: Web 界面角落的豆包 / sd娘 桌宠，可拖动缩放贴边，悬浮显示今日出图开销以及豆包客户端与火山引擎套餐两边的额度用量；同时注册 Agent 工具，可走本机豆包工作模式或火山引擎方舟 API 出图。
icon: https://raw.githubusercontent.com/afeiaswell/dsh-doubao-pet/main/assets/icon-180.png
```

> 描述里若出现 `: `（冒号+空格）必须加引号，否则 YAML 解析成嵌套键。当前文本用的是分号，无需引号。

## 提交步骤

1. 仓库加 topic：https://github.com/afeiaswell/dsh-doubao-pet → About 右侧齿轮 → Topics → `dsh-plugin` → Save
2. Fork 目录仓库：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin → Fork
3. 推分支到自己的 fork：

   ```powershell
   git clone git@github.com:afeiaswell/awesome-dsh-plugin
   cd awesome-dsh-plugin
   git checkout -b add-doubao-pet
   # 写入 data/plugins/afeiaswell__dsh-doubao-pet.yml（内容见上）
   git add data/plugins/afeiaswell__dsh-doubao-pet.yml
   git commit -m "Add afeiaswell/dsh-doubao-pet"
   git push -u origin add-doubao-pet
   ```

4. 打开 fork 页面，点绿色 **Compare & pull request** 提交
5. 等 CI：`dsh.bundle` / 仓库年龄 / awesome-lint 三项
   - 若被 `repo too new` 拦住，**无需操作**：规则写明门槛会自动重跑，达标后自己变绿
   - 失败信息会说清要改什么，推到同一分支即可，不用重开 PR
6. 维护者打 `held: author` 表示要改；改完留一条评论说明即可

## 一个 PR 只能加 1–3 条

多插件请拆分，并只提交最值得留的那几个。

## 参考

- 收录规则全文：`awesome-dsh-plugin/awesome-dsh-plugin/contributing.md`
- 现有条目示例（同分类）：`data/plugins/0-0-user__dsh-plan-note.yml`
