# Example VideoHub · 介绍 · 教程 · 示例

> 一个用 **Material Design 3** 做的视频站：视频全部来自 **哔哩哔哩**，
> 后台输入 **bvid** 即可投稿，画面与弹幕走 B 站官方内嵌播放器，简介 / UP 主 / 数据 / 评论都来自 B 站。
> **没有账号系统**，内容由站长在后台策展（分类整理）。

- 技术栈：**Vue 3 + Vite + Vuetify 3（MD3）** 前端；**零依赖 Node（`node:http`）** 后端；
  同一份后端代码既能本地跑，也能作为 **Vercel Serverless** 函数运行。
- 线上演示：<https://your-app.vercel.app>（部署自己的实例后替换成你的域名）
- 本文档是**独立教程**（不依赖 README），从零开始跑起来、投稿、分类、部署、以及在"B 站封机房 IP"时的补救办法。

![首页](docs/images/home.png)

---

## 目录

1. [它是什么](#1-它是什么)
2. [功能一览](#2-功能一览)
3. [项目结构](#3-项目结构)
4. [快速开始（本地）](#4-快速开始本地)
5. [教程：投稿一个 B 站视频](#5-教程投稿一个-b-站视频)
6. [教程：分类整理](#6-教程分类整理)
7. [教程：播放与小窗](#7-教程播放与小窗)
8. [教程：B 站评论](#8-教程b-站评论)
9. [教程：部署到 Vercel](#9-教程部署到-vercel)
10. [教程：机房 IP 被 412 时，本地补齐再上传](#10-教程机房-ip-被-412-时本地补齐再上传)
11. [示例：数据文件](#11-示例数据文件)
12. [示例：API 调用](#12-示例api-调用)
13. [示例：ADMIN_TOKEN](#13-示例admin_token)
14. [验证脚本](#14-验证脚本)
15. [常见问题](#15-常见问题)
16. [边界与合规](#16-边界与合规)

---

## 1. 它是什么

一个"视频站外壳 + B 站内容源"的站点。它**不做视频转码、不代理视频流**，
播放用 B 站官方 iframe 播放器（`player.bilibili.com/player.html?bvid=…`），
其余信息（标题、简介、封面、UP 主、播放/点赞/投币数、分 P、B 站评论）通过 B 站公开 Web API 读取后存在自己的库里。

内容策展的方式就是"投稿"：在 `/admin` 里粘贴 **bvid**（或视频链接 / av 号），
服务端抓取元数据入库，站点首页立刻出现这个视频。

```
浏览器 ──► /api/videos            ──► 视频库（本地 JSON / 线上 Upstash KV）
   │            ▲
   │            └── 元数据来自 api.bilibili.com（+ 视频页 HTML 兜底）
   └──► /api/comments/:bvid     ──► /x/v2/reply/main（只读，热门/最新）
   └──► /api/image?url=…        ──► B 站图床代理（域名白名单）
   └──► /admin（投稿后台，纯 HTML，零依赖）
```

## 2. 功能一览

| 功能 | 说明 |
| --- | --- |
| 投稿 | 后台粘贴 bvid / 视频链接 / av 号，支持批量、去重、失败逐条给原因 |
| 元数据 | 标题、简介、封面、时长、发布日期、分区（一级 + 二级）、标签、UP 主、播放/弹幕/点赞/投币/收藏/分享 |
| 播放 | B 站官方内嵌播放器；多分 P 选集；宽屏；加载失败兜底提示 |
| **小窗播放** | 切换页面时正在播放的视频**不中断**，自动变成右下角小窗，可"回到视频页"或"关闭小窗" |
| 评论 | 两个标签页：**B 站真实评论**（热门/最新、楼中楼、只读）与 **本站评论**（存在浏览器本地） |
| 分类整理 | 后台自定义分类（与 B 站分区无关）：新建/重命名/删除/排序，主页按分类分区展示 |
| 收藏 | 浏览器本地收藏（按 bvid，无需账号），库中删掉的视频会自动清理 |
| 搜索 | 关键词（标题/简介/UP/分区/标签）+ 分区筛选 + 排序（最新收录/播放量/发布日期） |
| 主题 | 亮/暗两套 MD3 淡绿色配色，持久化 |
| 存储 | 本地：JSON 文件；线上：Upstash Redis / Vercel KV（同一套接口） |
| 鉴权 | `ADMIN_TOKEN` 保护所有写操作；浏览/播放/读评论不受影响 |
| 稳健性 | B 站风控（412）时**不丢投稿**：先存 bvid，之后自动/手动补齐（见第 10 节） |

### 小窗播放（截图）

![小窗播放](docs/images/mini-player.png)

## 3. 项目结构

```
server/
├── handler.js     共用请求处理器：静态站点 + /admin + JSON API + 图床代理 + 鉴权
├── index.js       本地 Node 服务（listen）
├── env.js         零依赖 .env 加载器（必须最先导入）
├── backend.js     存储驱动：JSON 文件 / Upstash Redis REST
├── store.js       视频库与分类的读写、记录归一化、待补齐（pending）状态
├── bilibili.js    B 站客户端：view/detail → view → 视频页 HTML 兜底、tid→分区、评论
├── config.js      读取根目录 config.json（品牌 / 页脚 / 链接）
├── seed.js        空库兜底内容（提交版 = 示例库，部署时使用）
└── data/          本地库 videos.json / collections.json（已 gitignore）
api/index.js       Vercel 函数入口（包一层 handler）
config.json        站点品牌配置（名称 / 页脚 / 链接；见第 4 节）
public/admin.html  投稿后台（纯 HTML/CSS/JS，构建时复制到 dist/）
src/               Vue 3 前端（views / components / store / api）
scripts/           工具：部署、KV 巡检、本地补齐上传、各套验证
examples/          示例数据文件（见第 11 节）
docs/images/       本文档用的截图
```

## 4. 快速开始（本地）

```bash
npm install                 # 依赖：vue / vuetify / vite / mdi 字体
cp .env.example .env        # Windows: copy .env.example .env
# 编辑 .env，至少设置：ADMIN_TOKEN=你的口令

npm run dev                 # ① 前端开发服务器 http://127.0.0.1:5173
npm run start               # ② 另开一个终端：后端 http://127.0.0.1:8787

# 或者一步到位（构建 + 用后端同时服务前端和 API）：
npm run serve               # = npm run build && node server/index.js
```

- 打开 **<http://127.0.0.1:8787/>** 是站点，**<http://127.0.0.1:8787/admin>** 是投稿后台。
- `npm run dev`（5173）通过 Vite 代理把 `/api` 转发到 8787；想换目标用 `API_TARGET=http://…`。
- 首次运行如果 `server/data/` 不存在，会退回 `server/seed.js` 的内容（只读兜底）；
  一旦你在后台投稿/删除，就会生成 `server/data/videos.json` 并以它为准。
- 想要一份"示例库"直接开箱可看，见第 11 节。

> 端口/监听地址：`PORT`（默认 8787）、`HOST`（默认 127.0.0.1）。

### 改站点名称（`config.json`）

站点的品牌名只有一个来源：仓库根目录的 **`config.json`**。

```json
{
  "brandOwner": "Example",
  "brandProduct": "VideoHub",
  "siteName": "Example VideoHub",
  "tagline": "基于 Material Design 3 构建的视频分享站点",
  "footerNote": "版权所有 · 视频与信息来自哔哩哔哩 · 基于 Material Design 3 构建",
  "repoUrl": "",
  "deployUrl": ""
}
```

- 改完 **前端要重新 `npm run build`（或重新部署）**，服务端下次启动生效：
  Vite 构建时把配置注入前端（导航栏 / 页脚 / HTML 标题），服务端读它做启动横幅与 `GET /api/config`，
  `/admin` 页面在运行时从 `GET /api/config` 取名称。
- `siteName` 省略时自动用 `brandOwner + 空格 + brandProduct`。
- `deployUrl` 会被 `npm run sync` 当作默认线上地址（也可以改用 `LIVE_BASE` 环境变量，放在 `.env` 里）。
- 不想把自己的名字提交进 git？把品牌写进另一个 JSON，再用 `M37_CONFIG=./my-config.json` 指过去
  （服务端与 `npm run build` 都认这个变量）。

## 5. 教程：投稿一个 B 站视频

1. 打开 `/admin`，如果服务器启用了 `ADMIN_TOKEN`，先在提示条里填入口令并「保存口令」
   （口令只存在你浏览器的 `localStorage`，键名 `m37_admin_token`）。
2. 在「BV 号 / 视频链接」文本框中粘贴，点「提交投稿」：

   ```
   BV1GJ411x7h7
   https://www.bilibili.com/video/BV1GJ411x7h7/
   av80433022
   ```

   - **批量**：每行一个，或用空格 / 逗号分隔（顺序请求、间隔 350ms，降低被风控概率）。
   - **去重**：同一个视频再次提交 = 刷新元数据，并且**保留它的分类**。
   - **失败有原因**：`视频不存在或已被删除`、`访问被拒绝（可能是番剧、付费或仅限登录的内容）`、
     `请求过于频繁，请稍后再试`、`412 request was banned` 等，逐条显示。
3. 提交成功后，卡片会出现在「视频库」里，站点首页 / 搜索页立刻可见。
4. 每条记录可：**刷新元数据**、**站点预览**、**在 B 站打开**、**删除**。

![投稿后台](docs/images/admin.png)

> **勾上「只存链接，暂不抓取元数据」**：完全不访问 B 站，先把 bvid 存下来（记录标记为 `待补齐`），
> 之后有人访问该视频时自动补齐 —— 这是机房 IP 被 B 站 412 时的稳妥做法（第 10 节）。

### 视频页长什么样

标题、分区、标签、UP 主卡片、统计条、简介、B 站评论全部来自 B 站：

![视频页](docs/images/video-page.png)

## 6. 教程：分类整理

「分类」是**你自己的整理方式**，与 B 站分区无关。后台第二张卡片可以：新建、重命名、删除、上下排序。

- 每条视频卡片上有一个下拉框，把它归到某个分类（或「未分类」）。
- 主页表现：
  - **有分类时**：顶部出现分类 chip，下面**每个分类一个区块**（标题 + 数量 + 「查看全部」+ 该分类的视频），
    未归类的视频集中在最后的「未分类」区块 —— **每个视频恰好出现一次**；
  - **没有分类时**：退回「推荐」网格 + B 站一级分区 chip。
- 分类名支持中文（但不能包含 `:`）；**删除分类不会删除视频**，只会把它们变回未分类。

## 7. 教程：播放与小窗

- 视频页的播放器是**全局只挂载一次**的（`src/components/GlobalPlayer.vue` + `<Teleport to="body">`），
  它被绝对定位"贴"在视频页预留的槽位上 —— 这样跨页面跳转时 iframe 不会被移动或重建，**播放不中断**。
- 直接点导航、返回首页、搜索别的视频：播放器自动缩成**右下角小窗**，标题栏有「回到视频页」和「关闭小窗」。
- 回到该视频页会自动**重新停靠**，仍然是同一个 iframe（不重新加载，播放进度不丢）。
- 多分 P：播放器下方/侧栏「视频选集」切换 `page`，B 站播放器会按 `?page=N` 切换。

## 8. 教程：B 站评论

视频页「评论」区域有两个标签页：

- **B 站评论**（默认）：真实评论，可切「热门 / 最新」，支持楼中楼（B 站只随主楼返回前几条，
  更多会提示"剩余的在 B 站查看"），标注「来自哔哩哔哩 · 只读」，可一键「去 B 站评论」。
- **本站评论**：存在你自己浏览器里（`m37_comments`），可以发/删/点赞，**不会同步到 B 站**。

后端对评论页面做了 60 秒内存缓存，避免频繁请求上游；若某条视频缺 `aid`，
服务端会顺手把它的元数据补齐（这也是"待补齐"记录的一种自愈途径）。

## 9. 教程：部署到 Vercel

Vercel 的文件系统是**只读**的，所以线上必须挂一个外部 KV（Upstash Redis）。

### 9.1 准备

```bash
# 1) 链接项目（会在本地生成 .vercel/project.json —— 已 gitignore）
npx vercel link --project <你的项目名>

# 2) 配环境变量（Vercel 控制台 → Settings → Environment Variables）
#    ADMIN_TOKEN=你的口令
#    以及 Storage → Upstash for Redis 建库后自动注入的：
#    KV_REST_API_URL / KV_REST_API_TOKEN
```

### 9.2 部署

```bash
# 方式 A：仓库自带的 REST 部署脚本（推荐；不依赖 CLI 的 user profile）
$env:VERCEL_TOKEN="你的 Vercel Token"   # 或写入 .vercel-token（已 gitignore）
npm run deploy                          # 上传当前工作树 → 生产部署 → 等就绪
npm run deploy -- --no-wait              # 不等待
npm run deploy -- --target preview       # 预览环境

# 方式 B：官方 CLI
npx vercel deploy --prod

# 方式 C：接 Git 仓库，push 自动部署（长期推荐）
```

`vercel.json` 关键点：`framework: vite`、`buildCommand: npm run build`、`outputDirectory: dist`、
`regions: ["hkg1"]`、`functions["api/index.js"].maxDuration: 60`，
重写规则把 `/api/(.*)` → `/api`、`/admin` → `/admin.html`、`/(.*)` → `/index.html`（SPA 深链接）。
**不要加 `cleanUrls: true`**：它会让 `/index.html` 308 跳到 `/`，catch-all 失效、深链接 404。

### 9.3 首次数据迁移（可选）

```bash
# 把本地库整体写进线上 KV（会回读校验）
$env:KV_REST_API_URL="https://<你的库>.upstash.io"
$env:KV_REST_API_TOKEN="<Upstash REST Token>"
npm run kv -- ping        # 连通性 + 已有键
npm run kv -- dump        # 看线上有什么
npm run kv -- seed        # 本地 server/data/*.json → 线上 KV
npm run kv -- clear       # 清空（线上会退回 server/seed.js）
```

### 9.4 部署后自检

```bash
npm run check:deployed -- https://<你的域名>
```

覆盖：健康检查与存储驱动、内容接口、`/admin`、深链接（`/video/xxx`、`/search`、`/favorites` 直接刷新）、
鉴权顺序、KV 写入持久化往返、B 站评论、图床代理。

## 10. 教程：机房 IP 被 412 时，本地补齐再上传

### 背景（实测结论）

B 站会按**出口 IP** 拦截：来自 Vercel / 云主机的请求访问
`api.bilibili.com/x/web-interface/*` 会被判 `412 request was banned`，
而且同一个 IP 连 `https://www.bilibili.com/video/<bvid>/`（视频页 HTML 兜底）也会 412。
实测同一分钟内三条链路一起 412：

```
（本次尝试：接口 view/detail 412；接口 view 412；视频页 HTML 412）
```

它不是请求头的问题（试过 8 种请求头组合，全部 412），而且**是间歇性的** ——
同一天也实测到过"线上投稿直接成功"。**浏览、播放、B 站评论、分类/删除线上视频始终正常。**

### 站点的兜底设计

1. **投稿永远不会因为抓不到元数据而失败**：抓不到就只存 bvid，记录标记为 `metadataState: "pending"`（待补齐）。
2. **抓到就自动重试**：任何人打开这条视频时，前端会调一次
   `POST /api/videos/:bvid/hydrate`（无需口令，服务端限流 20 秒 / 每个 bvid），
   成功即刻出现封面 / 简介 / UP 主 / 分区 / 评论；失败则保留原因，下次访问再试。
   B 站评论接口发现缺 `aid` 时也会顺手补齐。
3. **后台可手动**：卡片上有「补齐元数据」按钮，并有 `待补齐` 标记、上次失败原因、占位缩略图。
4. **UI 不假装知道**：待补齐的视频页显示提示条 +「立刻补齐」，**不显示 UP 主卡片、不显示全 0 的统计栏**；
   主页卡片用渐变占位封面。

![待补齐状态](docs/images/pending-metadata.png)

### 最有效的一招：`npm run sync`（本机抓，传到线上）

上传走本站自己的 `POST /api/videos/import`（需 `ADMIN_TOKEN`，只接受白名单字段），
**完全不经过 B 站** —— 所以线上能不能访问 B 站都无所谓。

```powershell
# 让 Node 走系统代理（仅在"本机 DNS 解析 *.vercel.app 不正常"时需要）
$env:HTTPS_PROXY="http://127.0.0.1:7897"
$env:HTTP_PROXY="http://127.0.0.1:7897"
$env:NODE_USE_ENV_PROXY="1"

npm run sync -- list      # ① 看线上有哪些视频、哪些缺元数据（默认命令）
npm run sync -- hydrate   # ② 用本机家宽 IP 抓 B 站 → 写进本地库
npm run sync -- push      # ③ 上传到线上 + 回读校验
npm run sync -- run       # ①②③ 一条龙
```

`list` 的真实输出（线上有一条投稿踩了 412）：

```
线上：https://your-app.vercel.app
存储：Upstash Redis / Vercel KV · 可写 · 口令：已启用
视频 8 个 / 分类 2 个

#  状态     bvid           标题                              UP 主         分类      缺失
------------------------------------------------------------------------------------------------
1  ⏳ 待补齐 BV1QJ411m7fy   BV1QJ411m7fy                      -             -         封面,UP主,aid,…
2  ✅ 完整  BV1Ky411q7QC   《明日方舟》EP - Mystic Light Que…明日方舟      音乐

汇总：8 个视频，其中 1 个需要补齐
```

`run` 的真实输出（把上面那条补齐了）：

```
补齐方式：本地服务 http://127.0.0.1:8787（driver=file）—— 由它抓取并写入本地库
[1/1] BV1QJ411m7fy … ✔ 接口 · 《明日方舟》「喧闹法则」EP - SPEED OF LIGHT by DJ Okawari · UP 明日方舟 · 1P
上传 1 条到 https://your-app.vercel.app
  批次 1：1/1 成功
上传完成：1/1 成功，回读校验通过 1 条
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--base <url>` | 目标实例（默认线上地址；`--base http://127.0.0.1:8787` 可本地演练） |
| `--all` | 连完整的记录也重新抓一遍（刷新播放量 / 分 P） |
| `--bvids A,B` | 只处理指定 bvid（也可以是线上还没有的 = 本地补好再投上去） |
| `--limit N` / `--delay ms` | 限制条数 / 抓取间隔（默认 1200ms） |
| `--dry` / `--no-store` | 只演练 / 不写本地库 |
| `--direct` / `--local <url>` | 强制直接写本地 JSON / 指定本地服务地址 |
| `--with-collection` | 连分类一起覆盖线上（**默认不动线上策展的分类**） |
| `--json` | `list` 输出 JSON，便于脚本消费 |

> **注意**：本地服务（`npm run start`）在运行时，`hydrate` 会自动改成调用它的 HTTP 接口，
> 而不是直接改 `server/data/videos.json` —— 服务进程持有一份内存缓存，直接改文件会在它下一次写入时被整份覆盖。

### 另一条路：让本地后台直连线上 KV

把 KV 变量给本地服务，它抓完元数据就直接写进线上库，Vercel 站点立刻可见：

```powershell
$env:KV_REST_API_URL="https://<你的库>.upstash.io"
$env:KV_REST_API_TOKEN="<Upstash REST Token>"
npm run start        # 打开 http://127.0.0.1:8787/admin 正常投稿 / 分类
```

## 11. 示例：数据文件

`examples/` 里放了两份可以直接用的示例数据（**4 个视频 / 2 个分类**，全部来自公开的 B 站内容）：
把它复制到 `server/data/`，本地就会以它为库 —— 也正是本仓库提交版 `server/seed.js`（空库兜底）的来源。

```bash
mkdir -p server/data
cp examples/videos.example.json      server/data/videos.json
cp examples/collections.example.json server/data/collections.json
npm run start        # 首页立刻能看到这些示例视频
```

示例库的内容：

| bvid | 状态 | 分类 | 说明 |
| --- | --- | --- | --- |
| `BV1Ky411q7QC` | 完整 | 音乐 | 《明日方舟》EP（UP：明日方舟） |
| `BV1GJ411x7h7` | 完整 | 音乐 | 【官方 MV】Never Gonna Give You Up（UP：索尼音乐中国） |
| `BV1Deht6rEpZ` | 完整 | 示例分类 | 伪纪录片（UP：沢人），展示第二个分类区块 |
| `BV1Q541167Qg` | **待补齐** | 未分类 | 只有 bvid：演示"只存链接"的状态与主页占位封面 |

> 这里没有多分 P 的视频（B 站的搜索接口对脚本请求返回 `412`，没法挑一个分 P 多的视频进来），
> 但字段是通用的：换个有多分 P 的 bvid，播放器下方会自动出现「视频选集」。

### 视频记录字段（`videos.json`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `bvid` | string | **必填**，B 站视频 ID（`BV` + 10 位） |
| `aid` / `cid` | number | B 站 av 号 / 第一个分 P 的 cid（评论接口需要 `aid`） |
| `title` / `desc` | string | 标题 / 简介 |
| `cover` | string | 封面 URL（B 站图床，会走 `/api/image` 代理） |
| `duration` | number | 时长（秒） |
| `pubdate` | number | 发布日期（秒级时间戳） |
| `category` / `categoryParent` | string | 二级 / 一级分区名（由 `tid` 映射而来） |
| `tags` | string[] | 标签 |
| `owner` | object | `{ mid, name, face }` |
| `stat` | object | `{ view, danmaku, reply, like, coin, favorite, share }` |
| `pages` | object[] | 分 P：`{ page, part, duration, cid }` |
| `metadataState` | string | `"complete"` 或 `"pending"`（待补齐）；缺字段的记录会被自动判定为 pending |
| `metadataSource` | string | 元数据来源：`"api"` / `"html"` / `"local"` |
| `metadataError` | string | 上次补齐失败的原因（待补齐时显示在后台） |
| `collectionId` | string | 所属分类 id（空 = 未分类） |
| `addedAt` | number | 入库时间（毫秒时间戳，决定"最新收录"排序） |

> 读取时会**自动补齐缺失字段**（`pages` / `stat` / `owner` / `addedAt` 等），
> 所以即使你只写 `{ "bvid": "BV1GJ411x7h7" }` 也不会把页面弄崩 ——
> 它会以「待补齐」的形式显示，然后你点后台的「补齐元数据」即可。

### 分类文件（`collections.json`）

```json
[
  { "id": "col-music", "name": "音乐", "order": 0 },
  { "id": "col-投稿", "name": "投稿", "order": 1 }
]
```

`id` 由后台自动生成（小写化 + 随机后缀），`order` 决定主页区块顺序，视频用 `collectionId` 引用它。

## 12. 示例：API 调用

所有接口都在 `/api` 下（本地 `http://127.0.0.1:8787`，线上 `https://<域名>`）。

### 读

```bash
# 站点状态：库内数量 / 存储驱动 / 是否需要口令 / 是否可写
curl http://127.0.0.1:8787/api/health

# 列表（关键词 / 分区 / 分类 / 排序 / 指定 bvid）
curl "http://127.0.0.1:8787/api/videos?sort=play"
curl "http://127.0.0.1:8787/api/videos?keywords=miku&category=音乐"
curl "http://127.0.0.1:8787/api/videos?collection=<分类id>"
curl "http://127.0.0.1:8787/api/videos?ids=BV1GJ411x7h7,BV1QJ411m7fy"

# 单条 / 分区列表 / 分类列表
curl http://127.0.0.1:8787/api/videos/BV1GJ411x7h7
curl http://127.0.0.1:8787/api/categories
curl http://127.0.0.1:8787/api/collections

# B 站评论（mode=hot|time，next 翻页）
curl "http://127.0.0.1:8787/api/comments/BV1GJ411x7h7?mode=hot"

# 图床代理（只允许 B 站域名）
curl "http://127.0.0.1:8787/api/image?url=https%3A%2F%2Fi0.hdslb.com%2Fbfs%2Farchive%2Fxxx.jpg"
```

### 写（需要 `ADMIN_TOKEN`）

```bash
# 投稿（单条 / 批量）
curl -X POST http://127.0.0.1:8787/api/videos \
  -H "X-Admin-Token: 你的口令" -H "Content-Type: application/json" \
  -d '{"input":"BV1GJ411x7h7\nhttps://www.bilibili.com/video/BV1QJ411m7fy/"}'

# 只存链接（不访问 B 站，先存成"待补齐"）
curl -X POST http://127.0.0.1:8787/api/videos \
  -H "X-Admin-Token: 你的口令" -H "Content-Type: application/json" \
  -d '{"input":"BV1QJ411m7fy","deferMetadata":true}'

# 补齐待补齐的元数据（访客也可调用，服务端限流 20 秒/bvid）
curl -X POST http://127.0.0.1:8787/api/videos/BV1QJ411m7fy/hydrate

# 刷新元数据 / 归类 / 删除
curl -X POST  http://127.0.0.1:8787/api/videos/BV1GJ411x7h7/refresh -H "X-Admin-Token: 你的口令"
curl -X PATCH http://127.0.0.1:8787/api/videos/BV1GJ411x7h7 \
  -H "X-Admin-Token: 你的口令" -H "Content-Type: application/json" -d '{"collectionId":"col-music"}'
curl -X DELETE http://127.0.0.1:8787/api/videos/BV1GJ411x7h7 -H "X-Admin-Token: 你的口令"

# 分类：新建 / 重命名 / 排序 / 删除
curl -X POST   http://127.0.0.1:8787/api/collections -H "X-Admin-Token: 你的口令" \
  -H "Content-Type: application/json" -d '{"name":"游戏精选"}'
curl -X PATCH  http://127.0.0.1:8787/api/collections/<id> -H "X-Admin-Token: 你的口令" \
  -H "Content-Type: application/json" -d '{"name":"游戏"}'
curl -X POST   http://127.0.0.1:8787/api/collections/reorder -H "X-Admin-Token: 你的口令" \
  -H "Content-Type: application/json" -d '{"ids":["<id2>","<id1>"]}'
curl -X DELETE http://127.0.0.1:8787/api/collections/<id> -H "X-Admin-Token: 你的口令"

# 写入"已在别处抓好的"完整记录（本地补齐 → 上线用的就是它）
curl -X POST http://127.0.0.1:8787/api/videos/import \
  -H "X-Admin-Token: 你的口令" -H "Content-Type: application/json" \
  -d '{"records":[{"bvid":"BV1QJ411m7fy","title":"示例标题","cover":"https://i0.hdslb.com/…jpg","aid":76271270}]}'
```

```js
// Node 18+（fetch 内置）：把本地库里"待补齐"的记录全部补齐
const res = await fetch('http://127.0.0.1:8787/api/videos')
const { items } = await res.json()
for (const v of items.filter((x) => x.metadataState === 'pending')) {
  const r = await fetch(`http://127.0.0.1:8787/api/videos/${v.bvid}/hydrate`, { method: 'POST' })
  console.log(v.bvid, await r.json())
}
```

### 鉴权的三种写法

```bash
-H "X-Admin-Token: 你的口令"              # 请求头（后台页面用的就是这个）
-H "Authorization: Bearer 你的口令"       # Bearer
"?token=你的口令"                          # 查询参数（方便直接在浏览器地址栏点）
```

## 13. 示例：ADMIN_TOKEN

```ini
# .env（不要提交；.gitignore 已忽略）
ADMIN_TOKEN=换成一个只有你知道的随机串
# PORT=8787
# 线上（Vercel）另需：
# KV_REST_API_URL=…
# KV_REST_API_TOKEN=…
```

- 设置后：**所有写操作**（投稿 / 刷新 / 补齐 / 导入 / 删除 / 分类增删改）都需要口令；
  浏览、搜索、播放、读评论、图床代理不需要。
- 未设置时本地完全开放（方便上手），**部署到公网前务必设置**，否则任何人都能改你的库。
- 后台页面把口令存在浏览器 `localStorage`（键 `m37_admin_token`），只发给自己的服务器。
- 口令变更后，旧口令立刻失效；记得同时更新 Vercel 的环境变量并重新部署。

## 14. 验证脚本

| 命令 | 内容 |
| --- | --- |
| `npm run check:api` | 服务端 API 断言（58 项，非破坏性，需要本地服务在跑） |
| `npm run check:interaction` | UI 交互断言（60 项：小窗全流程、评论、分类往返、待补齐全流程…） |
| `npm run check:visual` | 截图 + 控制台错误检查（输出到 `shots/`） |
| `npm run check:vercel` | 云端模拟：用 `api/index.js` 起无状态函数 + 空数据目录 + 只读环境（17 项） |
| `npm run check:deployed -- <url>` | 验证已部署实例（22 项：深链接、KV 持久化往返、鉴权顺序…） |
| `npm run sync -- list` | 线上内容巡检 + 缺元数据清单 |

这些脚本都用**系统自带的 Edge**（`playwright-core`，不下载浏览器），
并且**不会删除你已有的视频**：临时新增的视频 / 分类会在结束时清理，测试用到的视频分类会恢复原值。

环境变量：`BASE=` `ADMIN_TOKEN=` `EDGE_PATH=` `API_TARGET=` `OUT=`（截图目录）`PROXY_SERVER=` `LIVE_BASE=` `LOCAL_BASE=`。

## 15. 常见问题

**Q：首页没有视频 / 显示"前端尚未构建"？**
先 `npm run build`（或直接用 `npm run serve`）。后端只负责把 `dist/` 发出去。

**Q：`/admin` 提示不可写（503）？**
线上（Vercel）文件系统只读，必须配 KV：Vercel 控制台 → Storage → Upstash for Redis，
注入 `KV_REST_API_URL` / `KV_REST_API_TOKEN` 后重新部署一次即可，代码不用改。

**Q：投稿报 `412 request was banned`？**
见第 10 节。它不影响浏览/播放/评论；用 `npm run sync` 在本机补齐再上传，或等一会儿重试（拦截是间歇的）。

**Q：播放器一直转圈 / 提示加载不出来？**
内嵌播放器来自 `player.bilibili.com`；如果网络访问不了 B 站、或浏览器插件拦截了 iframe，就会这样。
可点播放器右上角「在原站观看」。

**Q：评论为空？**
某些视频关闭了评论区，或该视频是番剧/付费内容；也可能是 B 站接口临时限流，稍后再试。

**Q：图片裂了？**
封面走 `/api/image` 代理，只允许 `hdslb.com` / `biliimg.com` / `bilivideo.com`。
如果部署在无法访问 B 站的网络，代理也会失败。

**Q：深链接刷新 404（线上）？**
检查 `vercel.json` 的 catch-all 重写 `/(.*) → /index.html` 是否存在，且**没有**开 `cleanUrls`。

**Q：`npm run deploy` 报 `缺少 Vercel Token`？**
设置 `VERCEL_TOKEN` 环境变量，或把 Token 写进 `.vercel-token`（两者都已 gitignore）。
另外需要先 `npx vercel link` 生成 `.vercel/project.json`。

**Q：本机 DNS 解析 `*.vercel.app` 不对？**
让 Node 走系统代理：`HTTPS_PROXY` / `HTTP_PROXY` + `NODE_USE_ENV_PROXY=1`（脚本里的浏览器用 `PROXY_SERVER`）。

## 16. 边界与合规

- 只读取 B 站**公开 Web API 的元数据**与**公开评论**；播放使用**官方内嵌播放器**；
  **不解析、不抓取、不代理任何视频流地址**，也不会向 B 站提交点赞/投币/收藏等写操作。
- 站点没有账号系统；收藏与本站评论只存在访问者自己的浏览器里。
- 站内展示的视频信息与画面版权归原 UP 主 / 哔哩哔哩所有；
  请遵守 B 站的服务条款与相关法律法规，**不要用于商业用途**（Vercel 免费版本身也仅限非商业用途）。
- 部署到公网时请务必设置 `ADMIN_TOKEN`；`.env`、`.vercel-token`、`.vercel/`、`server/data/` 都不要提交。

---

<sub>Example · VideoHub · 基于 Material Design 3 构建 · 视频与信息来自哔哩哔哩</sub>
