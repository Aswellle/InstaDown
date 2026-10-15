<div align="center">

<img src="build/icon-256.png" width="120" alt="InstaDownloader logo" />

# InstaDownloader

**把 Instagram 媒体完整地归档在你自己的硬盘上。**

[![Release](https://img.shields.io/badge/Release-v0.2.0-rose?logo=github)](../../releases)
[![Tests](https://img.shields.io/badge/Tests-100%20passing-16a34a?logo=vitest)](#开发)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?logo=electron)](#下载)
[![License](https://img.shields.io/badge/License-MIT-8b5cf6)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4)](#参与贡献)

*粘贴链接 → 预览多图 → 批量下载 → 永久归档。全程本地完成，无需登录。*

[下载](#下载) · [功能亮点](#功能亮点) · [工作原理](#工作原理) · [参与贡献](#参与贡献)

</div>

---

> [!IMPORTANT]
> **无登录优先**：公开内容一律匿名获取，你的 Instagram 账号不进入任何请求路径。
> 仅 Stories 等 IG 机制上必须由账号查看的内容才经由会话，且执行前显式提醒。
> 详见 [FAIR_USE.md](FAIR_USE.md)。

## 为什么是 InstaDownloader

Instagram 的 CDN 链接几小时就过期，收藏的帖子会随时间消失；而市面工具要么要求你交出账号 Cookie 全程携带（风控风险极高），要么只是个网页在线解析器（有隐私顾虑、无法批量）。

InstaDownloader 的答案是三个设计承诺：

| 承诺 | 做法 |
|------|------|
| 🔒 **账号安全第一** | 会话按端点分级——公开内容**绝不**携带你的 Cookie；需要账号的功能先匿名尝试、被拒才用，且执行前弹窗提醒并提供回退 |
| 📁 **本地优先** | 解析、预览、下载、管理全部在本机完成，不上传任何数据；文件按 `用户名/日期/类型` 自动归档 |
| 🖼️ **所见即所得的库** | 图片缓存到本机（CDN 过期后依然可见）；全屏媒体库支持按作者/类型/关键字检索与批量下载 |

## 功能亮点

<div align="center">
  <img src="docs/img/light-grid.jpg" width="820" alt="解析结果网格" />
  <p><sub>粘贴链接即得预览网格 —— 类型角标、分辨率与拍摄日期一目了然</sub></p>
</div>

**解析与预览**
- 帖子 / Carousel 多图 / Reels / Stories / 用户主页，支持直接输入用户名
- 多图帖子完整解析（老帖 contextJSON 缺失时自动走多层回退）
- Apple Photos 式多选网格：单击选、Shift 连选、Ctrl 点选、全选

**应用内闭环**（不跳系统浏览器）

<div align="center">
  <table>
    <tr>
      <td><img src="docs/img/light-selection.jpg" alt="多选批量下载" /></td>
      <td><img src="docs/img/light-viewer.jpg" alt="应用内查看器" /></td>
    </tr>
    <tr>
      <td align="center"><sub>Shift 连选 + 悬浮批量操作栏</sub></td>
      <td align="center"><sub>应用内查看器：翻页 / 元信息 / 一键下载</sub></td>
    </tr>
  </table>
</div>

- 图片/视频查看器：左右翻页、`Enter` 下载、悬停显示快捷键
- 下载历史直接读本地文件在应用内查看（含视频拖动进度条），不拉起系统看图器
- 主页归档分页浏览：每次"再加载 10 条"，节奏可控

**下载引擎**
- 并发 1–6 可调、断点续传（Range + `.part`）、失败自动重试（1s/4s/16s 退避）
- 暂停/恢复/取消/重试、任务持久化、重启自动恢复

**媒体管理**
- 全屏媒体库：真实缩略图网格 + 作者/类型/关键字检索 + 四种排序 + 批量下载
- 下载历史带缩略图，一眼认出每项是什么
- 头像与缩略图本地缓存（自定义 `instadown-img://` 协议），链接过期不再是占位符

<div align="center">
  <table>
    <tr>
      <td><img src="docs/img/light-library.jpg" alt="全屏媒体库（浅色）" /></td>
      <td><img src="docs/img/dark-library.jpg" alt="全屏媒体库（深色）" /></td>
    </tr>
    <tr>
      <td align="center"><sub>浅色主题</sub></td>
      <td align="center"><sub>深色主题</sub></td>
    </tr>
  </table>
</div>

**桌面体验**
- 浅色 / 深色 / 跟随系统三态主题（浅色默认），Windows 窗口控制按钮区同步跟随
- 剪贴板智能分类检测：帖子链接、主页链接、用户名各有差异化提示
- 破坏性操作（清空历史/缓存、退出登录）全部二次确认

## 下载

| 平台 | 获取方式 |
|------|----------|
| **Windows** | [Releases](../../releases) 下载 `InstaDownloader Setup x.x.x.exe`（NSIS 安装器） |
| **macOS / Linux** | 推送 `v*` 标签后由 CI 自动构建 DMG / AppImage（见 [发布流程](#发布流程)） |

系统要求：Windows 10+ / macOS 12+ / 主流 Linux 发行版。

## 快速开始

1. 打开应用，直接**粘贴** Instagram 链接（或输入用户名）——剪贴板有链接时会自动提示
2. 在网格中**选择**想要的媒体（Shift 连选最快）
3. 点击**下载所选**（或 `Ctrl+Enter`），文件自动归档到 `图片/InstaVault/{用户名}/{日期}/`
4. 左上角「媒体库」随时回看已归档内容——支持全屏网格视图

无需注册、无需登录即可使用上述全部功能。

## 工作原理

```
┌─────────────────────────────────────────────┐
│  Renderer (React 19 + Zustand + Tailwind 4)  │
│         ↕ contextBridge（最小 IPC 面）         │
│  Main (Electron 44)                          │
│   ├─ SQLite (node:sqlite, WAL)  任务/媒体/历史 │
│   ├─ 下载引擎  断点续传 · 重试 · 并发限流        │
│   └─ 图片缓存  instadown-img:// 自定义协议      │
│         ↕ JSON-RPC over stdio                 │
│  Python Worker（零第三方依赖）                  │
│   └─ 公开 embed 解析 · 多层回退 · 会话分级       │
└─────────────────────────────────────────────┘
```

- **解析路径**：公开 embed 元数据（IG 官方为嵌入场景提供）→ oEmbed → 页面渲染结果，多层回退保证成功率
- **会话分级**：公开路径绝不携带 Cookie；`media_info` 等端点先匿名、被登录墙拒绝才作为最后手段重试；Stories 显式声明使用会话
- **隐私**：所有解析与下载在本机完成，会话 Cookie 经 safeStorage 加密仅存本机

## 开发

```bash
npm install          # Electron 二进制受限时: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
npm run dev          # 开发模式（HMR）
npm test             # Vitest 单元 + 集成测试（含真实 Python Worker 进程）
npm run test:py      # Python Worker 测试（纯标准库 unittest）
npm run typecheck    # TS 类型检查
npm run dist:dir     # 打包（目录级，验证用）
npm run dist         # 打包发布版（win nsis / mac dmg / linux AppImage）
```

要求：**Node ≥ 22、Python ≥ 3.11**（worker 零 pip 依赖）。环境变量 `INSTADOWN_PYTHON` 可指定解释器。

测试覆盖：队列状态机、断点续传、URL 分类、多图回退、会话分级、selector 稳定性等 **100 个用例**（Vitest 53 + unittest 47）。

## 发布流程

```bash
# 1. 更新 package.json 的 version 并提交
# 2. 打标签推送 → GitHub Actions 自动三平台构建并创建 Release
git tag v0.3.0
git push origin v0.3.0
```

本机验证：`npm run dist:dir`（目录级）或 `npm run dist`（安装器）。

## Instagram 数据获取说明

仅使用公开网页端点与公开 App 头（与浏览器访问一致），不做任何鉴权绕过。
未登录受限（多数数据中心 IP 会遇到）时，应用给出明确引导：可在应用内打开
Instagram 官方登录窗口完成登录（凭据直接提交给 Instagram，本应用不接触密码），
或粘贴你自己已登录浏览器的会话 Cookie（`sessionid=…`），该值仅经加密保存在本机。

**账号安全设计**：公开内容一律匿名获取（默认不带任何会话），需要账号的功能
（Stories、私密内容）才会经由会话且执行前显式提醒——最小化账号暴露。

## 负责任使用

> 完整的项目边界与合规说明见 [FAIR_USE.md](FAIR_USE.md)。

- 仅归档**你有权访问**的内容：自己的账号、公开内容、或已获授权的内容
- **不要**用于批量抓取、监控他人、二次分发出他人内容，或任何侵犯他人
  隐私与著作权的行为
- 内置 1.5 秒请求间隔节流，请勿移除或绕过；高频访问既触发 IG 风控
  （你的账号可能被临时限制），也不符合本项目的使用意图
- 私密账号内容一律拒绝解析（应用内建限制，非可选项）

## 免责声明

1. 本项目与 Instagram / Meta Platforms 无任何关联，也未经其认可。
2. Instagram 服务条款禁止未经授权的自动化数据收集。使用本工具即表示你
   理解并自行承担由此产生的一切风险与责任，包括但不限于账号受限。
3. 本软件按"现状"提供（MIT 许可证），作者不对使用方式或 IG 平台政策
   变化导致的任何后果负责。
4. 如你代表 Instagram / Meta 认为本仓库内容存在问题，请通过 Issue 联系，
   会在 24 小时内响应处理。

## 参与贡献

欢迎 Issue 与 PR！约束见 [FAIR_USE.md](FAIR_USE.md#给贡献者的约束)：
不接受增加批量采集、绕过限流、绕过登录墙能力的改动。

```bash
git clone https://github.com/Aswellle/InstaDown.git
cd InstaDown && npm install && npm run dev
```

提交前请确保 `npm test`、`npm run test:py`、`npm run typecheck` 全部通过。

如果这个项目对你有用，欢迎点一个 ⭐ Star —— 这是对独立开发者最实在的鼓励，
也能让更多需要它的人看到。


## License

[MIT](LICENSE)
