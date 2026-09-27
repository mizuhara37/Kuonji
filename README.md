# Kuonji

> 站点名由仓库根目录的 `config.json` 配置（导航栏 / 页脚 / HTML 标题 / `/admin` 全部读它）。

其实是自己用来分享视频的网站吧，用dsh写的，如果有类似的需求可以试试吧
一个用 **Material Design 3** 设计的视频站点，界面结构仿照
[KotokawaAkira/VideoStation](https://github.com/KotokawaAkira/VideoStation)，
内容完全来自哔哩哔哩：

- 投稿在 **Node.js 后台页面**（`/admin`）完成——输入 B 站视频的 **bvid** 即可；
- 视频画面由 **B 站官方内嵌播放器**播放（带原生清晰度、倍速、弹幕）；
- 标题、**简介**、分区、标签、时长、**UP 主信息**与点赞投币收藏等数据全部来自 B 站；
- 评论区默认显示**真实的 B 站评论**（热门 / 最新、楼中楼、点赞数，只读）；
- 可以**自定义分类**整理视频，主页会按分类分区展示；
- 切换页面时**正在播放的视频会进入小窗**继续播放；
- 站点前端是只读的：没有账号系统，也没有投稿入口。

---

## 快速开始

```bash
npm install
npm run serve        # 构建前端 + 启动 Node 服务
```

| 地址 | 说明 |
| --- | --- |
| http://127.0.0.1:8787/ | 站点首页 |
| http://127.0.0.1:8787/admin | **投稿后台**（投稿 + 分类管理） |
| http://127.0.0.1:8787/api/health | 服务状态、存储驱动、是否需要口令 |

开发模式（前端热更新，API 代理到 8787）：

```bash
npm run start        # 终端 1：Node 服务
npm run dev          # 终端 2：Vite，http://127.0.0.1:5173
```

---

## 小窗播放

播放器**只在 App 顶层挂载一次**，然后靠定位在「页面内」和「小窗」之间切换：

- 在视频页时，播放器用绝对定位精确贴合页面里的占位槽（`getBoundingClientRect` + 父级 `ResizeObserver` + 短暂重测），
  所以你看到的就是普通的内嵌播放器；
- 一旦离开视频页（去首页 / 搜索 / 收藏），占位槽消失，播放器自动变成右下角的小窗，
  带标题、**回到视频页**和**关闭小窗**两个按钮；
- 点「回到视频页」会重新贴合回去。

关键点：**跨域 iframe 一旦被移动或重建就会重新加载、播放进度归零**，所以实现上全程不移动、
不重建这个 iframe，只改它的定位——小窗和页面内播放的是同一个元素，声音和进度都不中断。
自动化测试里用「在元素上打一个 JS 标记，导航后标记仍在 + iframe src 未变」来验证这一点。

> 因为跨域限制，页面无法读取 iframe 的播放状态，所以小窗是「只要你打开过视频页就一直存在」，
> 而不是「只在真正播放时才出现」；暂停后不想看到它，点关闭即可。

---

## 投稿后台（/admin）

粘贴 **BV 号**、**av 号**或**完整视频链接**，点「提交投稿」：

```
BV1GJ411x7h7
https://www.bilibili.com/video/BV1GJ411x7h7/
av80433022
```

- **批量**：每行一个，或用空格 / 逗号分隔（顺序请求，间隔 350ms 降低风控概率）。
- **自动去重**：重复的 BV 号变成**刷新元数据**，并且**保留它的分类**。
- **失败有原因**：`视频不存在或已被删除`、`访问被拒绝（可能是番剧、付费或仅限登录的内容）`、
  `请求过于频繁，请稍后再试` 等。
- 每条记录可：**刷新元数据** / **站点预览** / **在 B 站打开** / **删除**。
- **勾选「只存链接，暂不抓取元数据」**：完全不访问 B 站，先把 bvid 存下来
  （用于机房 IP 被 B 站 412 拦截时），之后随时补齐 —— 见下一节。

### 元数据待补齐（只存 bvid）

B 站会对机房 IP（Vercel / 云主机）返回 `412 request was banned`，所以**投稿永远不会因为抓不到元数据而失败**：

1. **先存 bvid**：提交后立刻入库，记录标记为 `metadataState: "pending"`（标题暂时就是 bvid）。
2. **抓取链路**（按顺序尝试，任意一环成功即结束）：
   `/x/web-interface/view/detail`（含 tags）→ `/x/web-interface/view` → **视频页 HTML**
   （`https://www.bilibili.com/video/<bvid>/` 里的 `window.__INITIAL_STATE__.videoData`）。
   第三条走的是 `www.bilibili.com` 而不是 `api.bilibili.com`：本机家宽实测可用（标题 / 简介 / 封面 /
   UP 主 / 分 P / 数据全都有），但从线上机房发起实测**同样 412**（见下方实测）。
3. **自动重试**：任何访问者打开这条视频时，前端会调一次
   `POST /api/videos/:bvid/hydrate`（**不需要口令**，服务端做 20 秒 / 每个 bvid 的频率限制），
   成功后封面、简介、UP 主、分区、评论（aid）会立刻出现；
   失败则保持待补齐并记下原因，下次访问再试。
   B 站评论接口被调用时如果发现缺 `aid`，也会顺手把这套元数据补齐。
4. **后台手动**：卡片上有「补齐元数据」按钮，并有 `待补齐` 标记、上次失败原因、占位缩略图。

待补齐期间的 UI 不会"假装知道"：视频页显示提示条 + 「立刻补齐」按钮，**不显示 UP 主卡片、不显示全 0 的统计栏**，
简介位置写明"稍后会自动重试"；主页卡片用渐变占位封面 + `待补齐` 状态，视频本身照常播放。

> 实测：
> - **本机家宽 IP**：`接口 view/detail`、`接口 view`、视频页 HTML 三条链路都能用（HTML 那条能拿到完整元数据）。
> - **线上 hkg1 部署**：同一分钟内三条链路**一起** 412，后台会显示
>   `（本次尝试：接口 view/detail 412；接口 view 412；视频页 HTML 412）`——
>   即 B 站是按出口 IP 拦整个 `bilibili.com`，HTML 兜底救不了机房 IP。
>   此时记录保持 `待补齐`：拦截是**间歇性**的（同一天实测到过"线上投稿直接成功"），
>   之后有人访问会自动重试；想立刻就补齐，用下面的 `npm run sync`（推荐）或本地后台直连线上 KV。

### 本地补齐后上传（`npm run sync`）

线上机房 IP 抓不到元数据时，最省事的补救是**用本机的家宽 IP 抓，再把结果传到线上**。
上传走本站自己的 `POST /api/videos/import` 接口（只接受白名单字段、需要 `ADMIN_TOKEN`），
**完全不经过 B 站**，所以线上能不能访问 B 站都不影响。

```bash
# 从这台机器访问 *.vercel.app 需要走系统代理（本机 DNS 的问题）
$env:HTTPS_PROXY="http://127.0.0.1:7897"; $env:HTTP_PROXY="http://127.0.0.1:7897"; $env:NODE_USE_ENV_PROXY="1"

npm run sync -- list      # 1. 看线上有哪些视频、哪些缺元数据（默认命令）
npm run sync -- hydrate   # 2. 本机抓 B 站 → 补齐并写入本地库
npm run sync -- push      # 3. 上传到线上 + 回读校验
npm run sync -- run       # 上面三步一条龙

# 只想处理某几条 / 演练
npm run sync -- hydrate --bvids BV1QJ411m7fy
npm run sync -- run --base http://127.0.0.1:8787 --dry
```

`list` 的输出：

```
线上：https://your-app.vercel.app
存储：Upstash Redis / Vercel KV · 可写 · 口令：已启用
视频 8 个 / 分类 2 个

#  状态     bvid           标题                              UP 主         分类      缺失
------------------------------------------------------------------------------------------------
1  ⏳ 待补齐 BV1QJ411m7fy   BV1QJ411m7fy                      -             -         封面,UP主,aid,…
2  ✅ 完整  BV1Ky411q7QC   《明日方舟》EP - Mystic Light Que…明日方舟      音乐

汇总：8 个视频，其中 1 个需要补齐
  下一步：npm run sync -- run
```

参数与行为：

| 参数 | 作用 |
| --- | --- |
| `--base <url>` | 目标实例（默认 `LIVE_BASE` 或线上地址；可用 `http://127.0.0.1:8787` 演练） |
| `--all` | 连完整的记录也重新抓一遍（刷新播放量 / 分 P） |
| `--bvids A,B` | 只处理指定 bvid（可以是线上还没有的，等于"本地补好再投上去"） |
| `--limit N` / `--delay ms` | 限制条数 / 抓取间隔（默认 1200ms，降低被 B 站限流的概率） |
| `--dry` / `--no-store` | 只演练 / 不写本地库（只在内存里补齐） |
| `--direct` / `--local <url>` | 强制直接写本地 JSON / 指定本地服务地址（默认 `http://127.0.0.1:8787`） |
| `--with-collection` | 连分类一起覆盖线上（**默认不动线上策展的分类**） |
| `--json` | `list` 输出 JSON，便于脚本消费 |

- `hydrate` 会把结果写进本地库，所以本地库同时是一份线上镜像；
  需要更新提交版 seed 时再跑 `npm run seed:export`。
- **本地服务在运行时（`npm run start`），`hydrate` 会自动改成调用它的 HTTP 接口**，
  而不是直接改 `server/data/videos.json`：服务进程持有一份内存缓存，
  直接改文件会在它下一次写入（归类 / 删除 / 投稿）时被整份覆盖。用 `--direct` 可以强制直接写文件，
  这种情况脚本会打印警告。
- `push` 之后会**回读线上**校验：`metadataState` 是否变成 `complete`、封面 / aid 是否就位、
  以及（默认情况下）**分类有没有被改动**。
- 若本地设置了 KV 变量（`driver=kv`），`hydrate` 就是直接写线上库，`run` 会自动跳过 `push`。

实测（正好把线上一条真实的待补齐记录补齐了）：

```
[1/1] BV1QJ411m7fy … ✔ 接口 · 《明日方舟》「喧闹法则」EP - SPEED OF LIGHT by DJ Okawari · UP 明日方舟 · 1P（本地新增）
上传 1 条到 https://your-app.vercel.app
  批次 1：1/1 成功
上传完成：1/1 成功，回读校验通过 1 条
```

### 分类整理

后台第二张卡片可以新建 / 重命名 / 删除 / 上下排序**自定义分类**（与 B 站分区无关）。
每条视频卡片上有一个下拉框把它归到某个分类（或「未分类」）。

主页的表现：

- **有分类时**：分类 chip + 每个分类一个区块（标题 + 数量 + 「查看全部」+ 该分类的视频），
  未归类的视频会集中显示在最后的「未分类」区块里——**每个视频恰好出现一次**；
- **没有分类时**：退回原来的「推荐」网格 + B 站一级分区 chip。

分类名支持中文，删除分类**不会删除视频**，只会把它们变回未分类。

---

## 管理口令（ADMIN_TOKEN）

设置后，**所有写操作**（投稿 / 刷新 / 删除 / 分类增删改）都需要口令；浏览、搜索、播放、读评论不受影响。

在根目录 `.env` 里写一行（`.env` 不会被提交）：

```
ADMIN_TOKEN=你的口令
```

`.env` 已被 `.gitignore` 忽略，启动时由零依赖的 `server/env.js` 自动加载。
真实环境变量优先于 `.env`，所以部署到 Vercel 时只要你填了平台变量，这个文件不会干扰。

```bash
npm run start      # 读 .env，口令即你写的那串
npm run serve      # 先构建再启动
```

- 临时换口令：PowerShell `$env:ADMIN_TOKEN="别的口令"; npm run start`；bash `ADMIN_TOKEN=别的口令 npm run start`
- 不想启用：删掉 `.env` 里那一行即可（后台顶部会警告「任何人都能增删视频」）

### 在后台页面里使用

1. 打开 <http://127.0.0.1:8787/admin>
2. 顶部会出现带锁的提示条和口令输入框，粘贴你的口令，点 **保存口令**
3. 口令只存在你本机浏览器的 `localStorage` 里，之后投稿 / 删除 / 分类操作都会自动带上
4. 同一行的 **清除** 可以换口令或取消

没填口令时，任何写操作都会返回 401，后台会提示「口令错误或未填写，无法修改视频库。」

### 用 curl / 脚本调用

三种传法等价（请求头优先推荐）：

```bash
# 1. X-Admin-Token 请求头
curl -X POST http://127.0.0.1:8787/api/videos \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: 你的口令" \
  -d '{"input":"BV1GJ411x7h7"}'

# 2. Bearer
curl -X DELETE http://127.0.0.1:8787/api/videos/BV1GJ411x7h7 \
  -H "Authorization: Bearer 你的口令"

# 3. 查询参数（方便直接在浏览器地址栏点）
curl -X POST "http://127.0.0.1:8787/api/videos/BV1GJ411x7h7/refresh?token=你的口令"
```

`GET /api/health` 不需要口令，返回 `authRequired: true` 即可确认口令已生效。

### 验证脚本

`npm run check:api` 与 `npm run check:interaction` 会自动从 `.env` 读取 `ADMIN_TOKEN`，
所以启用口令后这两个脚本照常可跑（交互脚本还会自动把口令填进后台页面）。
`scripts/api-check.mjs` 里同时包含了「不带口令必须 401」的断言。

---

## 部署到 Vercel

### 本次部署结果（已完成）

| 项 | 值 |
| --- | --- |
| 线上地址 | **https://your-app.vercel.app** |
| 项目 | `<team>/<project>`（本仓库用 `npx vercel link` 关联到本地 `.vercel/`） |
| 运行区域 | `hkg1`（香港，离 B 站更近，实测评论接口可用） |
| 环境变量 | `ADMIN_TOKEN`（Production Secret） |
| 存储 | **Upstash Redis（Vercel KV）**：建好库后线上/本地即可互通（示例库 4 个视频 + 2 个分类） |
| 内容来源 | 线上读 KV；KV 为空时才用 `server/seed.js`（`server/data/` 被忽略，seed 是空库兜底） |
| 已验证 | **22 项线上断言**：KV 读写持久化、分类增删改、深链接、鉴权、鉴权顺序、B 站评论、图床代理 |
| 元数据兜底 | 抓不到元数据时**只存 bvid**（`待补齐`），访客访问 / 后台按钮 / 评论接口都会自动重试补齐 |
| 已知限制 | 线上机房 IP 抓元数据会被 B 站按 IP 封（412，且视频页 HTML 同样 412）；投稿不丢，稍后自动重试或用本地后台直连线上 KV 补齐（见下） |

用 **Vercel Token + CLI** 部署（没走 Git 集成），项目已 link 到本地 `.vercel/`（已忽略）。

**部署过程中发现并修好了 3 个只在线上才会暴露的问题**——本地测试跑不出来，
因为本地那个 Node 服务自己实现了这些行为：

1. **`/api/categories` 返回 404**：重构 `server/handler.js` 时漏了这个分支。前端把它 catch 掉了，
   表现只是"抽屉里的分区列表空着"，不报错、极难察觉。已补上并加断言。
2. **深链接 404**：Vercel 默认没有 SPA fallback，直接访问或刷新 `/video/xxx`、`/search` 会 404
   （本地 Node 服务有 fallback）。已在 `vercel.json` 加 catch-all 重写。
3. **后台在只读部署上不显示口令输入框**：原来"存储不可写"的红条会把口令框顶掉，
   于是你看到"不可写"却没法在配好 KV 后立即解锁。现在两条提示同时显示。

> 另一个坑：`cleanUrls: true` 会让 `/index.html` 308 跳到 `/`，导致 catch-all 的
> `destination: /index.html` 命中不了、深链接依旧 404。所以**去掉了 `cleanUrls`**，
> `/admin` 继续靠显式重写工作。

### 重新部署 / 更新线上

```bash
# 方式 1：本仓库自带的部署脚本（推荐 —— 见下方说明）
#   需要 VERCEL_TOKEN 环境变量，或把 Token 写进 .vercel-token（两者都被忽略）
npm run deploy                    # 上传当前工作树 → 生产部署 → 等就绪并打印地址
npm run deploy -- --no-wait       # 不等待
npm run deploy -- --target preview

# 方式 2：官方 CLI（需要能通过 whoami 的 Token，或先 npx vercel login）
$env:VERCEL_TOKEN="你的token"
npx vercel deploy --prod --yes

# 方式 3：接 Git 仓库，让 Vercel 自动部署（长期推荐）
git init && git add -A && git commit -m "init"
git remote add origin <你的 GitHub 仓库> && git push -u origin main
# 再到 Vercel Import 该仓库，之后 push 自动部署
```

> **为什么还需要方式 1**：本次使用的 Vercel Token 是 team 作用域的，
> REST API 完全可用，但 CLI 会去加载"用户资料"并报 `User not found`，于是
> `vercel deploy` / `vercel env` 都用不了。`scripts/vercel-deploy.mjs` 直接调
> `POST /v13/deployments`（把源文件内联上传），因此这类 Token 也能部署。
> 另外注意：Vercel 控制台上的 **Redeploy 会复用上一次的源码快照**，
> 所以改了代码必须重新上传，光点 Redeploy 是拿不到新代码的。

本地改了视频库、想让只读的线上也更新：

```bash
npm run seed:export     # 把 server/data/*.json 导出为 server/seed.js
npx vercel deploy --prod --yes
```

### 让后台在线上可用（配置 KV）

**只需要两个变量**（`KV_URL` / `REDIS_URL` 这种 `rediss://` 连接串本项目用不到，不用填）：

```
KV_REST_API_URL   = https://<你的库>.upstash.io
KV_REST_API_TOKEN = <Upstash 的 REST Token>
```

加到 Vercel 项目的 Environment Variables（Production / Preview / Development 都勾上），
然后 **Redeploy 一次**即可，**代码一行都不用改**（`server/backend.js` 检测到变量就自动切驱动）。

配好后：`/admin` 顶部红条消失，用你的口令解锁就能投稿 / 删除 / 分类；
线上与本地各自独立（本地继续用 `server/data/*.json`），互不影响。

> 反之，如果你想让**本地也直接用 KV**，把这两个变量写进本地 `.env` 即可——
> 但那样本地就不再读 JSON 文件了，`npm run seed:export` 也就失去意义，所以默认不这么做。

#### 迁移 / 巡检线上库

`scripts/kv-tool.mjs`（`npm run kv -- <命令>`）能直接操作线上库：

```bash
# 需要先有 KV_REST_API_URL / KV_REST_API_TOKEN 环境变量
npm run kv -- ping        # 连通性 + 列出已有的 m37:* 键
npm run kv -- dump        # 看线上有多少视频 / 分类
npm run kv -- seed        # 把 server/data/*.json 整个覆盖写入线上（首次部署 / 迁移用）
npm run kv -- seed --dry  # 只看会写什么，不落盘
npm run kv -- clear       # 清空线上库（之后线上退回 server/seed.js 的内容）
```

> 首次部署时我已经用过 `seed`：线上库现在与本地完全一致，
> 并且写入后做了回读校验。之后你在线上后台做的改动都会直接生效到 KV。

### ⚠️ 在线上投稿的限制（实测结论）

**浏览、播放、B 站评论、收藏、分类/排序/删除线上视频，全部在线上正常工作**（已逐项验证）。
曾经常出问题的是**按 bvid 新增视频 / 刷新元数据**：B 站会按出口 IP 封
`/x/web-interface/*` 这一组接口，返回 `412 request was banned`。

**现在已经不会因此丢投稿了**（见上一节）：
- 抓取链路增加了**视频页 HTML** 兜底（走 `www.bilibili.com`，不是被封的 API 域名），
  实测能拿到标题 / 简介 / 封面 / UP 主 / 分 P / 播放数据；
- 仍然失败时只存 bvid（`metadataState: "pending"`），**有人访问该视频时自动重试**
  （`POST /api/videos/:bvid/hydrate` + 评论接口顺带补齐），后台也有「补齐元数据」按钮。

**它是间歇性的**：同一个部署，我实测到过成功、也实测到过连续 412（隔一段时间会恢复）。

这也不是请求头的问题——我在**线上部署里、用同一个 IP** 试了 8 种请求头组合，同一时刻全部 412：

| 请求头组合 | 结果 |
| --- | --- |
| 无头 / 仅 UA / UA+Referer / +Accept / +Origin / +Sec-Fetch-* / +buvid3 cookie / 换 Referer | **全部 `412 request was banned`** |
| `/x/v2/reply/main`（评论接口）作为对照 | **200 OK** |
| `https://www.bilibili.com/video/<bvid>/`（视频页 HTML）从**线上部署**发起 | **412**（同一个 IP 拦整个域名） |
| 同一个 HTML 请求从**本机家宽**发起 | **200 OK，含完整 `__INITIAL_STATE__.videoData`** |

即这是**按 IP**（不只是按接口）的拦截，换请求头没用（我一度加了"浏览器全套头"以为能绕过，实测证明无效，
后来把那套头去掉了）。`hkg1` 香港区域会被拦；换其他海外区域大概率一样，因为都是机房 IP。
拦截是**间歇性**的：`npm run check:deployed` 里"投稿/刷新"这一项实测通过过，也实测到过连续 412。

**更可靠的做法：让本地后台直连线上 KV。**

本地是国内家宽 IP，不会被封；把 KV 变量给本地后台，它就能抓元数据并**直接写进线上库**，
Vercel 站点立刻可见：

```powershell
$env:KV_REST_API_URL="https://<你的库>.upstash.io"
$env:KV_REST_API_TOKEN="<Upstash REST Token>"
npm run start
# 打开 http://127.0.0.1:8787/admin 正常投稿 / 分类 —— 直接落到线上 KV
```

实测：本地后台（`driver=kv`）投稿 `BV1JBaA6oEmA` → `HTTP 200 created=true tags=9`，
线上库 7 → 8 个视频，删除后回到 7。

另外两条路也可以：
- `npm run kv -- seed`：本地库整体覆盖写入线上（首次部署 / 批量迁移用）。
- 线上后台本身仍可用于**分类整理、排序、删除**（这些不需要访问 B 站，已在线验证）。

### ⚠️ 密钥轮换

Upstash 的 REST Token 与 Vercel Token 都属于凭据。如果它们曾经出现在聊天记录 / 截图里，
建议在 **Upstash 控制台 → Details → Rotate Token** 与 **Vercel → Account → Tokens** 里各轮换一次，
然后更新 Vercel 的环境变量（改完 Redeploy 一次即可，数据不受影响——Token 只影响访问权限）。

### 需要注意的坑

- **B 站 API 的地域性**：函数默认在海外节点，`api.bilibili.com` 对非国内 IP 可能限流或风控
  （返回 `-412` 之类）。已把区域设为 `hkg1`（香港）并实测评论接口可用；若投稿仍经常失败，
  把 API 部署到国内主机、或本地投稿后只把 Redis 数据给 Vercel 读，会更稳。
- **函数执行时间**：每次投稿都要请求 B 站（数百毫秒）+ 350ms 间隔，批量条数多容易撞上时长上限
  （已设 `maxDuration: 60`，免费版上限更低）。批量建议一次不超过 10 条。
- **图片代理**：封面 / 头像走 `/api/image`，会消耗函数调用；已加 `Cache-Control: max-age=86400`。
- Vercel 免费版仅限非商业用途，请自行确认合规。

---

## 服务端 API

`server/handler.js` 是共用的请求处理器：本地由 `server/index.js` 用 `node:http` 起服务，
Vercel 由 `api/index.js` 包一层函数。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 状态、库内数量、存储驱动、`authRequired`、`canWrite` |
| GET | `/api/videos` | 列表；`?keywords=` `?category=` `?collection=` `?sort=added\|play\|pubdate` `?ids=` |
| GET | `/api/videos/:bvid` | 单条记录（含 `collectionName`） |
| POST | `/api/videos` | 投稿：`{ "input": "BV号/链接/av号", "deferMetadata": false }`，支持多条；`deferMetadata: true` = 只存链接 |
| PATCH | `/api/videos/:bvid` | 归类：`{ "collectionId": "..." }`（空串 = 未分类） |
| POST | `/api/videos/:bvid/refresh` | 重新拉取元数据（保留分类） |
| POST | `/api/videos/:bvid/hydrate` | **补齐待补齐的元数据**（访客可调用、无需口令、每 bvid 限流 20 秒） |
| POST | `/api/videos/import` | **写入本地/别处抓好的完整记录**（`{ records: [...] }`，需口令；分类默认沿用线上，`withCollection: true` 才覆盖） |
| DELETE | `/api/videos/:bvid` | 从库中移除 |
| GET | `/api/collections` | 分类列表（含每个分类的视频数） |
| POST | `/api/collections` | 新建分类 `{ name }` |
| PATCH | `/api/collections/:id` | 重命名 `{ name }` |
| DELETE | `/api/collections/:id` | 删除分类（视频保留） |
| POST | `/api/collections/reorder` | 排序 `{ ids: [...] }` |
| GET | `/api/comments/:bvid` | 该视频的 **B 站评论**（`?mode=hot\|time`、`?next=<cursor>` 翻页） |
| GET | `/api/image?url=` | B 站图床代理（域名白名单） |
| GET | `/admin` | 投稿后台页面 |

**分区名称**：B 站匿名接口不再返回 `tname`（恒为空串），但 `tid` 仍有值，
所以服务端内置了 tid → 分区名映射（`server/bilibili.js`），并归纳出一级分区；
表里没有的新分区归入「其他」。视频页会同时显示一级分区与具体分区（如 `游戏 · 单机游戏`）。

---

## 数据与持久化

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 视频库 | 本地：`server/data/videos.json`；Vercel：Upstash Redis / Vercel KV | 所有访问者共享，由 `/admin` 维护 |
| 分类 | 本地：`server/data/collections.json`；Vercel：同上 | 独立文件，视频记录里的 `collectionId` 引用它 |
| 我的收藏 | 浏览器 `localStorage`（`m37_favorites`，存 bvid） | 无需账号；库中已删除的视频会自动清掉 |
| 本站评论 | 浏览器 `localStorage`（`m37_comments`） | 仅本地可见 |
| 匿名昵称 | 浏览器 `localStorage`（`m37_identity`） | 例如「深夜观众42」，用于署名的评论 |
| 主题（亮/暗） | 浏览器 `localStorage`（`m37_theme`） | |

两个 JSON 文件都可以**手写**：读取时会补齐缺失字段（`pages` / `stat` / `owner` / `addedAt` 等），
所以只写 `{ "bvid": "BV..." }` 也不会让页面崩，再用后台的「刷新元数据」或「补齐元数据」补全即可。
只写 `bvid` 的记录会被自动判定为 `metadataState: "pending"`（待补齐），
抓取成功后写回 `metadataState: "complete"`、`metadataSource: "api" | "html"`、
`metadataError`（上次失败原因）与 `metadataCheckedAt`（上次尝试时间）。

---

## 目录结构

```
server/
├── handler.js     共用请求处理器：静态站点 + /admin + API + 图床代理 + 鉴权 + 评论缓存
├── index.js       本地 Node 服务（listen + 启动信息）
├── env.js         零依赖 .env 加载器（必须最先导入）
├── backend.js     存储驱动：JSON 文件 / Upstash Redis REST
├── store.js       视频库与分类的读写、记录归一化、待补齐（pending）状态
├── bilibili.js    B 站 Web API 客户端 + 视频页 HTML 兜底、bvid 解析、tid→分区映射、评论、错误文案
└── data/          videos.json / collections.json（运行时生成，已 gitignore）
api/
└── index.js       Vercel 函数入口
public/
└── admin.html     投稿后台（纯 HTML/CSS/JS，构建时复制到 dist/）
src/
├── api/index.js   前端 API 客户端
├── store/
│   ├── player.js  全局播放器状态（停靠槽位 / 小窗 / 停靠高度）
│   ├── app.js     主题、Snackbar、匿名昵称、本地收藏
│   ├── ui.js      跨组件 UI 标记（底部评论条的占位）
│   └── comments.js 本地评论
├── components/
│   ├── GlobalPlayer.vue     只挂载一次的播放器宿主（停靠 / 小窗）
│   ├── BilibiliPlayer.vue   官方内嵌播放器 + 加载态 + 失败兜底 + 宽屏
│   ├── CommentSection.vue   评论容器（B 站评论 / 本站评论 两个标签页）
│   ├── BilibiliComments.vue B 站真实评论（热门/最新、楼中楼、只读）
│   ├── LocalComments.vue    本地评论（可发、可删、可点赞）
│   ├── VideoCard.vue / AppNavbar.vue / AppBottomNav.vue / AppFooter.vue …
├── views/         HomeView / SearchView / VideoView / FavoritesView / NotFoundView
├── utils/format.js
└── styles/global.css
scripts/
├── sync-metadata.mjs   本地补齐 → 上传线上（npm run sync）
├── vercel-deploy.mjs   REST API 部署（token 不走 CLI 的 user profile）
├── kv-tool.mjs         Upstash KV 巡检 / 整库覆盖 / 清空
└── check-*.mjs         各套验证脚本
.env / .env.example  本地配置（口令、KV、端口）
vercel.json          Vercel 构建与路由配置
```

---

## 设计系统

- **淡绿色** MD3 配色：主色 `#6BBF8A`（浅绿）+ 深绿 `on-primary`（按钮为浅绿底深绿字），
  中性色（`surface-container-*` / `outline-variant` / `background`）也全部改为绿调，
  所以整页不会再出现紫色。二级色沿用参考项目的 `--ava-soft: #9AC8E2`。
- 亮/暗两套完整颜色角色，明暗切换单一数据源（`store/app.js` → `v-app` → Vuetify）并持久化。
- MD3 字阶、形状标度、统一动效曲线 `cubic-bezier(0.2,0,0,1)`、涟漪、状态层、骨架屏、Snackbar、FAB。
- 响应式：`md` 断点以下切抽屉 + 底部导航；视频页网格在移动端重排为
  `播放器 → 选集/推荐 → 评论`；小窗在移动端贴着底部导航上方。
- 图标用 `@mdi/font`，字体用系统字体栈，后台页面零依赖，**不请求任何外部 CDN**。

---

## 验证

```bash
npm run serve               # 另开终端（本地服务）
npm run check:api           # 58 项服务端 API 断言（非破坏性）
npm run check:interaction   # 60 项 UI 交互断言（非破坏性）
npm run check:visual        # 截图 + 控制台错误检查
npm run check:vercel        # 云端部署模拟：函数入口 + 空数据目录 + 只读环境（17 项）

# 验证已部署的实例（Vercel 等）
npm run check:deployed -- https://your-app.vercel.app

# 线上元数据补齐（不是测试，是运维工具：list → hydrate → push）
npm run sync -- list
```

这些脚本都用**系统自带的 Edge**（`playwright-core`，无需下载浏览器），
并且**都不会删除你已有的视频**：临时新增的视频 / 分类都会在结束时清理，
测试用到的视频如果本来有分类，结束时会**恢复成原来的分类**。

`check:vercel` 是本项目最有价值的一个：它用 `api/index.js` 的默认导出（Vercel 的真实调用方式）
起一个 `node:http` 服务，`VERCEL=1` + 空数据目录，于是能在本地就复现"线上只读部署"的全部行为——
seed 是否生效、写操作是否给出正确提示、鉴权顺序、B 站上游可用性。改完部署相关代码先跑它。

`check:interaction` 覆盖：站点无投稿入口 → 视频页标题/UP 主/头像/空间链接/简介/统计/播放器都来自 B 站 →
**播放器与占位槽严丝合缝、信息条不压统计栏** → **B 站评论**（加载、来源标注、昵称/正文/头像、热门↔最新切换）→
**页脚版权不被固定评论条遮住**（矩形相交断言）→
**小窗播放全流程**（精确停靠 → 导航后变右下角小窗 → 同一元素存活、iframe src 未变 → 回到视频页重新停靠 → 关闭）→
后台建分类、归类、主页出现分类区块、卡片显示分类、chip 过滤、视频页分类 chip → 清理并恢复 → 收藏与本地评论 → 非法 bvid 报错 →
**待补齐全流程**（「只存链接」收录 → 视频页提示条 / 无 UP 主卡片 / 无 0 统计 → 主页占位封面 →
后台 `待补齐` 标记与「补齐元数据」按钮 → 补齐接口免口令且限流 → 清理）。

`check:deployed` 额外覆盖深链接（`/video/xxx`、`/search`、`/favorites` 直接刷新必须落到 SPA）——
这正是本地测不出、只在 Vercel 上暴露的那类问题。

### 本机网络的一个坑（`*.vercel.app`）

这台机器的 DNS 会把 `*.vercel.app` 解析到错误的 IP（实测是 Meta 的地址段），
所以 `curl` / Node 直连会超时，而浏览器和 .NET（`Invoke-WebRequest`）能通——因为它们走系统代理
`127.0.0.1:7897`。脚本已经支持代理：

```powershell
$env:HTTPS_PROXY="http://127.0.0.1:7897"
$env:HTTP_PROXY="http://127.0.0.1:7897"
$env:NODE_USE_ENV_PROXY="1"          # 让 Node 的 fetch 走代理（Node 24+）
$env:PROXY_SERVER="http://127.0.0.1:7897"   # 让脚本里的浏览器走代理
npm run check:deployed -- https://your-app.vercel.app
```

可用环境变量：`BASE=` `EDGE_PATH=` `API_TARGET=`（Vite 代理目标）`ADMIN_TOKEN=`（默认从 `.env` 读取）
`OUT=`（截图目录，默认 `shots`）`PROXY_SERVER=`。

---

## 说明与边界

- 只读取 B 站**公开 Web API 的元数据**，播放调用**官方内嵌播放器**；
  **不解析、不抓取、不代理任何视频流地址**，也不会向 B 站提交点赞/投币/收藏等写操作。
- 请遵守哔哩哔哩的用户协议与相关法律法规，仅用于个人学习与自建浏览页；
  视频版权归原 UP 主与哔哩哔哩所有。
- 参考项目 [KotokawaAkira/VideoStation](https://github.com/KotokawaAkira/VideoStation) 为 MIT 许可。
