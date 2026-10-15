# InstaDownloader

本地优先的 Instagram 媒体归档工具：URL 解析 → 媒体预览 → 选择 → 下载 → 本地管理。

![tech](https://img.shields.io/badge/Electron-44-47848F) ![tech](https://img.shields.io/badge/React-19-61DAFB) ![tech](https://img.shields.io/badge/Python-3.11-3776AB) ![tech](https://img.shields.io/badge/SQLite-node:sqlite-003B57)

## 功能（MVP，docs/01）

- **URL 解析**：帖子 / Carousel 多图 / Reels / Stories / 用户主页，支持直接输入用户名
- **无登录优先**：公开内容一律匿名获取，账号不进入请求路径；仅 Stories 等必须账号的功能才经由会话，且执行前显式提醒（账号安全最高优先）
- **媒体预览**：Apple Photos 式多选网格，双击放大（视频可播放），类型/时长/分辨率角标
- **应用内浏览**：图片/视频在应用内查看器完成翻页与下载，全程不跳系统浏览器
- **选择性 & 批量下载**：单击选、Shift 连选、Ctrl 点选、Ctrl+A 全选、Ctrl+Enter 下载
- **下载引擎**（docs/06、07）：并发 3（可调 1–6）、断点续传（Range + `.part`）、失败自动重试（1s/4s/16s 退避）、暂停/恢复/取消/重试，任务持久化，重启自动恢复
- **本地文件管理**（docs/10）：`Pictures/InstaVault/{用户名}/{日期}/{images|videos}/` 自动归类，重名自动加序号，支持自定义目录、在资源管理器中显示
- **下载历史与媒体库**：SQLite 持久化；历史项显示缩略图；媒体库提供**全屏网格视图**（关键字/类型/作者检索、四种排序、批量选择下载）
- **图片本地缓存**：头像与缩略图缓存到本机（自定义 `instadown-img://` 协议），CDN 链接过期后仍可正常显示
- **浅色 / 深色 / 跟随系统**三态主题，浅色为默认

## 架构

```
Renderer (React 19 + Zustand + Framer Motion + Tailwind 4)
   │ contextBridge（最小 IPC 面，沙箱化）
Main (Electron) ── SQLite(node:sqlite) / 下载引擎 / 任务队列 / 文件管理 / 图片缓存
   │ JSON-RPC over stdio（行分隔）
Python Worker（零第三方依赖）── Instagram Provider / 媒体解析
```

- 会话 Cookie（可选，用于 Stories 与私密内容）经系统级加密（safeStorage）仅存本机
- **会话按端点分级**：公开路径（embed 页 / og 页）绝不携带会话；需要账号的端点先匿名尝试、被拒后才作为最后手段使用
- 解析在本地完成，不上传任何用户数据（docs/11）

## 开发

```bash
npm install          # Electron 二进制下载受限时: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm run dev          # 开发模式（HMR）
npm test             # Vitest 单元 + 集成测试（含真实 Python Worker 进程）
npm run test:py      # Python Worker 测试（纯标准库 unittest）
npm run typecheck    # TS 类型检查
npm run build        # 构建产物
npm run dist:dir     # 打包（目录级，验证用）
npm run dist         # 打包发布版（win nsis / mac dmg / linux AppImage）
```

要求：Node ≥ 20、Python ≥ 3.11（无需 pip 依赖）。可用环境变量 `INSTADOWN_PYTHON` 指定解释器。

## 发布流程

版本发布通过 git 标签触发 CI 三平台构建：

```bash
# 1. 更新 package.json 的 version，提交
# 2. 打标签并推送 → GitHub Actions 自动构建 Win/mac/Linux 并创建 Release
git tag v0.2.0
git push origin v0.2.0
```

本机构建验证：`npm run dist:dir`（目录级）或 `npm run dist`（安装器）。

## Instagram 数据获取说明

仅使用公开网页端点与公开 App 头（与浏览器访问一致），不做任何鉴权绕过。
未登录受限（多数数据中心 IP 会遇到）时，应用给出明确引导：可在应用内打开
Instagram 官方登录窗口完成登录（凭据直接提交给 Instagram，本应用不接触密码），
或粘贴你自己已登录浏览器的会话 Cookie（`sessionid=…`），该值仅经加密保存在本机。
请遵守 Instagram 服务条款，仅归档你有权访问的内容。

## 文档

需求与设计规范见 [`docs/`](docs/)，开发过程产物（参考产品分析、技术设计、
开发报告）见 [`docs/dev/`](docs/dev/)。

## License

MIT
