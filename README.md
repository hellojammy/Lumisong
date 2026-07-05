<p align="center">
  <img src="web/public/brand/github-readme-hero.png" alt="Lumisong · 鸣光" width="100%">
</p>

# Lumisong

> Lumisong（鸣光）是一个面向个人学习、研究和非商业创作的三维音频可视化项目。

English: [README.en.md](README.en.md)  
技术白皮书：[中文](docs/TECHNICAL_WHITEPAPER.md) / [English](docs/TECHNICAL_WHITEPAPER.en.md)

## 使用限制

- 本项目仅允许非商业使用。未经作者明确授权，不得用于商业产品、商业演出、商业宣传、付费服务、SaaS、企业内部商业流程或其他以商业收益为目的的场景。
- 本项目包含音频分析、WebGL/Three.js 视觉呈现和桌面端壳应用，分析结果仅用于可视化表达，不应作为医学、司法、版权鉴定、声学测量或其他严肃判定依据。
- 使用者上传、录制或演示的音频素材需自行确认版权和授权。

完整授权条款见 [LICENSE](LICENSE)（PolyForm Noncommercial License 1.0.0）。

## 项目介绍

Lumisong 把音乐、语音、鸟鸣和环境声转换成可播放的三维声音图谱。每个节点代表一个被分析出的声音事件，节点的位置、大小、颜色、形态、连线、尾迹和相机运动共同呈现音频结构。

它不是单纯的播放器，也不是只针对鸟鸣的识别工具。更准确地说，Lumisong 是一个把声音转译成空间视觉体验的实验性应用：你可以上传一段音乐、一段人声、一段环境声，观察声音事件在三维空间中的节奏、能量和路径。

## 预览

<p align="center">
  <img src="docs/assets/lumisong-lianyi.png" alt="Lumisong demo" width="100%">
</p>

https://github.com/user-attachments/assets/bc84fc56-34c7-4f7a-b8c7-04514658aecf

## 主要功能

**音频分析**

Lumisong 支持上传音乐、人声、鸟鸣和环境声等本地音频，并在浏览器内完成分析。上传后会先做音频类型初判，再让用户确认或修改分析 profile，最终以用户选择为准。

**三维声音图谱**

分析结果会被转换成一组可播放的三维声音事件。横向对应时间推进，纵向和纵深表达音色、响度、音调纯净度等特征；颜色、大小、连线和尾迹共同呈现声音结构，让一段音频变成可以观察、回放和比较的空间对象。

**形态与配色**

同一份音频数据可以切换不同几何语言：玻璃球、光针、涟漪、晶钻、星环。默认配色为“融金”，也可切换冰蓝、翠序、琥珀等风格，用不同视觉语气观察同一段声音。

**运镜与播放**

主要运镜方式包括智能运镜、匀速运镜、自由运镜和飞船驾驶，更多模式中还包含飞船穿梭和呼吸环绕。智能运镜会根据播放进度、当前声音事件和整体空间分布自动调整镜头，适合直接观看完整音频。

**交互与桌面端**

播放器支持播放、暂停、进度拖动、全屏沉浸、刷新、读图标注、云雾、连击、渐隐谢幕和余韵呼吸等控制。也支持录音和录音回放，可以把现场声音快速转成三维图谱。macOS App 使用同一套 Web 产物打包，方便本地桌面运行。

## 快速开始

当前推荐使用 macOS App 体验。

- 下载地址：[release/Lumisong-0.1.0-macos-arm64.dmg](release/Lumisong-0.1.0-macos-arm64.dmg)
- 系统要求：macOS 13+，Apple 芯片（M 系列）

安装方式：

1. 下载 DMG。
2. 打开 DMG，把 `Lumisong.app` 拖到“应用程序”。
3. 首次打开如果提示无法验证开发者，右键 `Lumisong.app`，选择“打开”，再确认打开。
4. 也可以进入“系统设置 → 隐私与安全性”，在页面底部找到被拦截的 `Lumisong`，选择“仍要打开”。
5. 如果提示 App 已损坏、无法打开，或从 GitHub/网盘/聊天工具下载后被 macOS 隔离，可以执行：

```bash
xattr -rd com.apple.quarantine /Applications/Lumisong.app
```

如果仍然无法打开，再尝试清理全部扩展属性：

```bash
xattr -cr /Applications/Lumisong.app
```

## 开发运行

环境要求：Node.js 20+、npm。macOS App 打包需要 macOS 和 Swift 工具链。

```bash
cd web
npm install
npm run dev
npm test
npm run build
```

常用命令：

- `npm run dev`：本地调试。
- `npm run dev:host`：局域网设备访问。
- `npm test`：运行测试。
- `npm run build`：构建 Web 产物到 `web/dist/`。

```bash
# 仓库根目录
./macos/build-app.sh
./macos/package-dmg.sh
```

macOS 构建产物分别位于 `macos/build/Lumisong.app` 和 `macos/build/Lumisong-0.1.0-macos-arm64.dmg`。发布用 DMG 放在根目录 `release/`。

## 项目结构

```text
.
├── web/                 # 主 Web 应用，Vite + TypeScript + Three.js
├── macos/               # macOS App shell 与打包脚本
├── ios/                 # iOS App shell，仍在调试
├── backend/             # 离线预处理脚本
├── release/             # 当前发布用 macOS DMG
├── web/public/brand/    # Logo、README banner、图标等品牌资产
└── BRAND.md             # 品牌资产使用规范
```

## 致谢

- Lucio Arese 的 [Seeing Birdsong](https://www.lucioarese.net/portfolio_page/visual-birds/) 为本项目提供了关键的视觉语言启发：把声音事件组织成可观看的三维空间图谱，并在播放过程中用光、路径和镜头呈现声音结构。Lumisong 在这个思路上做了面向音乐、人声、鸟鸣和环境声的独立实现，与原作者及原项目无关联。
- [Three.js](https://threejs.org/)：三维渲染基础。
- [Essentia.js](https://mtg.github.io/essentia.js/)：浏览器端音频特征分析能力。

## 请作者喝杯咖啡

如果你觉得 Lumisong 有意思、对你的创作或研究有帮助，可以请作者喝杯咖啡，支持后续维护。

<p align="center">
  <img src="docs/assets/sponsor-qr.jpg" alt="请作者喝杯咖啡" width="360">
</p>


## 品牌资产

Logo、图标和 README banner 的统一规范见 [BRAND.md](BRAND.md)。后续修改 Logo 或生成新平台图标时，请以 `web/public/brand/` 中的定稿资产为准，避免不同端出现不一致的视觉版本。
