# chat-demo

[English](README.md) | 简体中文

基于 DeepSeek API 的静态聊天示例。无需应用后端，浏览器直接请求配置的 API 服务。

点击 [在线体验](https://deepseek-ai.github.io/chat-demo/) 即可使用，也可以前往 [Releases](https://github.com/deepseek-ai/deepseek-chat-demo/releases) 下载压缩包，解压后双击 `index.html` 在本地使用，无需安装或构建。首次使用时，请在设置中填写 API Key。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/deepseek-ai/chat-demo.git
cd chat-demo
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `dist/`，可部署到静态服务器，也可直接打开 `dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 模型供应商

设置 → 模型供应商提供两种选择：

- **DeepSeek 官方**（默认）：使用内置的 `https://api.deepseek.com` 接口，只需填写 API Key，全部功能可用。
- **自定义（第三方）**：填写 API 地址、API Key、接口协议与模型名称，可选 Anthropic 兼容（`/v1/messages`）或 OpenAI 兼容（`/v1/chat/completions`）。地址可带 `/v1`，也可直接填到端点；未写版本段时自动补 `/v1`。配置会先用模型列表接口校验，供应商没有该接口时仍可保存。

第三方接口由浏览器直接请求，因此必须允许跨域（CORS）。这些接口不支持 DeepSeek 专有能力：附件上传、语音输入、朗读、联网搜索、链接阅读、服务端标题与深度思考开关；会话标题取首条提问。供应商以 `reasoning_content` 或 `reasoning` 下发思考时，仍会按思考内容展示。

第三方 Anthropic 兼容接口先用 `Authorization: Bearer` 请求；服务端拒绝（401/403，或要求 `anthropic-version`）时自动改用 `x-api-key`、再退到原生 Anthropic 头重试，并在本次会话内记住可用的方式。只有 `*.anthropic.com` 会直接用原生头。

供应商没有 CORS 响应头时，可让开发服务器代为转发。带代理目标启动 `pnpm dev`：

```sh
DEV_PROXY_TARGET=http://192.168.1.10:3065 pnpm dev
```

然后把自定义供应商的 API 地址填成 `http://localhost:8090/proxy/v1`。该代理只存在于开发服务器；静态构建版本仍需接口本身支持 CORS，或自建网关。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                |
| ------------- | ------------------- |
| `pnpm dev`    | 启动开发服务器      |
| `pnpm build`  | 构建到 `dist/`      |
| `pnpm type`   | TypeScript 类型检查 |
| `pnpm lint`   | oxlint 检查         |
| `pnpm format` | oxfmt 格式化        |

[rspack.config.ts](rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理；这决定「DeepSeek 官方」的地址，第三方地址在设置中填写。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。第三方供应商的请求会去掉这些扩展字段，并按所选协议转换请求与流式响应。

```text
src/
  app/                 应用布局、主题与全局样式
  components/          聊天、设置、Markdown 等界面组件
  i18n/                中英文文案
  services/
    api/               API 请求、SSE 与协议类型
    chat/              会话、消息分支、本地存储与历史导入导出
    markdown/          Markdown 解析、代码高亮与图表
    speech/            录音与朗读
  utils/               通用工具
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
