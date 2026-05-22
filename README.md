# Slides Explainer

一个可部署的 slides explainer Web App。用户上传 PDF 课件后，服务端逐页渲染 slide 图片、抽取文字，并通过 Highland / OpenAI-compatible 网关生成详细中文讲解。

## 功能

- PDF 上传、文件大小限制、页数限制、类型限制
- 服务端逐页渲染 slide PNG，并抽取每页文本
- 每页生成中文讲解：原页要点、详细解释、容易混淆点、这一页要记住什么
- 桌面端左侧解释、右侧 slide；手机端 slide 在上、解释在下
- 顶部页码导航、页内原图弹窗、处理进度、错误提示
- 单页重新生成讲解
- 生成完成后保存为可复访文档链接；同一份 PDF 再上传会命中缓存，不重复调用模型
- 支持选中 AI 讲解或抽取原文后继续提问，并在可拖动浮窗里追加回答
- MVP 优先支持 PDF；PPTX 建议先导出为 PDF，后续可接入 PPTX 转 PDF 服务

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，上传 `c1.pdf` 或其他 PDF。

## 环境变量

```bash
HIGHLAND_BASE_URL=https://your-highland-gateway.example/v1
HIGHLAND_API_KEY=sk-...
HIGHLAND_MODEL=gpt-4o-mini
BETA_ACCESS_CODE=

MAX_UPLOAD_MB=25
MAX_PAGES=80
PDF_RENDER_SCALE=1.8

RATE_LIMIT_WINDOW_MIN=15
PROCESS_RATE_LIMIT=6
REGENERATE_RATE_LIMIT=30
ASK_RATE_LIMIT=60
MAX_CONCURRENT_JOBS=2
AI_REQUEST_TIMEOUT_SECONDS=90
TOTAL_JOB_TIMEOUT_SECONDS=240
SLIDE_TEXT_CHAR_LIMIT=5000
DOCUMENT_STORE_DIR=./data/documents
```

说明：

- `HIGHLAND_BASE_URL` 和 `HIGHLAND_API_KEY` 只在服务端使用，不会暴露给浏览器。
- `HIGHLAND_MODEL` 需要选择支持图像输入的模型，因为每页会把 slide 图片和抽取文字一起发给模型。
- 如果不用 Highland，也可以设置 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 作为兼容 fallback。
- `BETA_ACCESS_CODE` 是可选的小范围测试访问码。留空时不启用；设置后，上传和重新生成都需要前端填写同一个访问码。修改后需要重启服务。
- `PROCESS_RATE_LIMIT` 是每个 IP 在一个时间窗口内可上传处理的 PDF 次数。
- `REGENERATE_RATE_LIMIT` 是每个 IP 在一个时间窗口内可重新生成单页讲解的次数。
- `ASK_RATE_LIMIT` 是每个 IP 在一个时间窗口内可对选中文字继续提问的次数。
- `MAX_CONCURRENT_JOBS` 是单实例同时处理的 PDF 任务数。公开 MVP 建议从 `2` 或 `3` 开始。
- `AI_REQUEST_TIMEOUT_SECONDS` 控制单页模型调用超时；`TOTAL_JOB_TIMEOUT_SECONDS` 控制整份 PDF 任务超时。
- `SLIDE_TEXT_CHAR_LIMIT` 会截断超长的 PDF 文字抽取结果，避免提示词失控；图片仍会完整传给视觉模型。
- `DOCUMENT_STORE_DIR` 是本地文件系统持久化目录。适合本地和单机小规模测试；正式公开部署建议替换成数据库 + 对象存储。

## 公开 MVP 加固

当前版本已经包含一组轻量保护：

- 每个 IP 的上传处理限流。
- 每个 IP 的单页重新生成限流。
- 每个 IP 的选中文字追问限流。
- 单实例全局并发任务限制，避免多个大 PDF 同时拖垮进程。
- 上传大小、页数、文件类型限制。
- 单页 AI 请求超时和整份 PDF 任务超时。
- 超长页面文字截断，降低模型上下文和费用风险。
- Highland API Key 只读取服务端环境变量，不进入浏览器 bundle。
- 可选 `BETA_ACCESS_CODE`，适合邀请制小范围测试，避免陌生访问者消耗模型额度。
- 已生成文档保存到服务端存储，并提供 `/documents/{id}` 复访链接。
- 同一份 PDF 用 SHA-256 文件指纹去重，再上传时直接返回历史讲解，避免重复模型费用。
- Docker 构建会通过 `.dockerignore` 排除 `.env.local`、本地样例 PDF、临时输出目录和构建缓存。
- 页面和响应头默认设置 `noindex`，适合小范围公开测试阶段，降低被搜索引擎收录的概率。

这些保护是公开 MVP 的第一道门，适合小规模试运行。正式开放更大流量时，建议继续加：

- Cloudflare / Nginx / 平台侧限流。
- 用户登录和每用户额度。
- 后台任务队列，例如 BullMQ、Cloud Tasks 或平台队列。
- 对象存储保存 slide 图片，数据库保存任务历史。
- 管理后台查看失败率、模型费用和用户用量。

## 文档持久化

当前 MVP 使用 PDF 内容的 SHA-256 作为文档 ID，处理完成后保存：

```text
data/documents/{sha256}.json
```

用户可以反复打开：

```text
/documents/{sha256}
```

这让同一份 PDF 不需要反复上传和重复生成。公开产品版本建议改成：

- 数据库保存文档元数据、用户归属、处理状态、页级解释。
- 对象存储保存 PDF 原件和 slide 图片，例如 S3、R2、Supabase Storage。
- 文档表里保留 `file_hash` 唯一索引，用于跨用户或同用户去重。
- 如果涉及隐私课件，默认只在同一用户账号下复用，不做全站公开复用。

## 小规模公开测试建议

建议先用偏保守的配置跑 10-30 个可信用户：

```bash
BETA_ACCESS_CODE=choose-a-shared-test-code
MAX_UPLOAD_MB=15
MAX_PAGES=30
PROCESS_RATE_LIMIT=3
REGENERATE_RATE_LIMIT=10
ASK_RATE_LIMIT=30
MAX_CONCURRENT_JOBS=1
TOTAL_JOB_TIMEOUT_SECONDS=180
```

测试期间重点观察：

- Highland 后台的模型调用次数、失败率和费用。
- 部署平台的 CPU / 内存 / 请求超时。
- 大 PDF、扫描版 PDF、图片很多的 PDF 是否会明显变慢。
- 用户是否上传了敏感课件；当前版本已在首页提示不要上传敏感或保密文件。

## 部署

### 推荐：Render Blueprint / Docker

当前仓库包含 `render.yaml`，适合小规模公开测试：

1. 把项目推送到 GitHub。
2. 在 Render 选择 Blueprint，连接这个仓库。
3. Render 会使用仓库根目录的 `Dockerfile` 构建服务，并把持久化磁盘挂载到 `/app/data`。
4. 在 Render 的环境变量界面填写：
   - `HIGHLAND_BASE_URL`
   - `HIGHLAND_API_KEY`
   - `HIGHLAND_MODEL`
   - `BETA_ACCESS_CODE`，可选；建议小范围测试先设置一个共享访问码

用户访问公开网址时不需要自己的 API Key；所有 AI 调用都由服务端使用你配置的 Highland Key 发起。

### Vercel

1. 推送到 GitHub。
2. 在 Vercel 新建项目，框架选择 Next.js。
3. 设置环境变量：`HIGHLAND_BASE_URL`、`HIGHLAND_API_KEY`、`HIGHLAND_MODEL`。
4. 部署。

注意：多页 PDF 会连续渲染并调用模型， serverless 执行时间可能成为瓶颈。页数较多时建议提高 `MAX_PAGES` 和 `TOTAL_JOB_TIMEOUT_SECONDS` 前，先确认部署平台的函数时长和费用。

### Docker / Railway / Render

```bash
docker build -t slides-explainer .
docker run --env-file .env.local -p 3000:3000 -v slides-data:/app/data slides-explainer
```

这类 Node 服务更适合处理较长 PDF，因为进程生命周期和函数时长限制更宽松。
如果使用 Docker，请挂载 `/app/data`，否则容器重建后本地文件系统里的已生成文档会丢失。

## PPTX 后续方案

PPTX 的稳定做法是先在后端转换为 PDF，再复用当前 PDF 渲染和讲解链路。可选路径：

- LibreOffice headless：适合 Docker / VM 部署
- CloudConvert / ConvertAPI：适合 serverless 部署
- 用户端手动导出 PDF：MVP 当前策略
