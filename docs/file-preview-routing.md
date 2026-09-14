# Moss 文件预览解析路由

本文档记录 Moss 桌面端实际启用的文件预览路由。它描述的是当前代码行为，不是 Open File Viewer README 中所有“可识别格式”的宣传矩阵。

## 总体规则

| 条件 | 实际解析方式 |
|---|---|
| 文本、代码需要编辑、保存、撤销或历史快照 | Moss 原生 Viewer |
| Word/PowerPoint 有 LibreOffice | LibreOffice 转 PDF，再由 Moss Chromium PDF Viewer 展示 |
| Word/PowerPoint 无 LibreOffice，或转换失败 | Open File Viewer（OFV）Office 插件 |
| Excel 有 LibreOffice且不是宽表 | Moss 解析表格，同时 LibreOffice 转 PDF 展示 |
| Excel 有 LibreOffice但属于宽表 | Moss HTML 表格，最多 500 行、100 列 |
| Excel 无 LibreOffice | OFV Office 插件 |
| `csv/tsv` | 始终使用 Moss 表格，不依赖 LibreOffice |
| PDF、普通图片、Markdown、常用代码等两边都支持但尚未决定切换 | 暂时保留 Moss |
| Moss 不支持而 OFV 能完整或基础解析 | OFV |
| OFV 只能识别容器、结构或元数据 | OFV，并在界面显示“结构预览”警告 |
| HTML 页面、普通网页 URL | Moss HTML/Browser Viewer |
| 未知 UTF-8 文本 | Moss Text Viewer |
| 未知二进制 | 不支持，提示使用系统应用打开 |

能力等级：`完整` 表示 OFV 有对应内容 Viewer；`基础` 表示复杂布局或专有对象可能降级；`结构` 表示只承诺容器、目录、概要或元数据，不承诺完整内容。

## Office

| 格式 | 实际路由 | 说明 |
|---|---|---|
| `docx/docm/dotx` | 有 LO → Moss PDF；无 LO/转换失败 → OFV | OFV 使用 docx-preview，并带 Mammoth/OpenXML 降级 |
| `doc/dot/rtf/odt` | 有 LO → Moss PDF；无 LO/转换失败 → OFV 基础 | 旧二进制 Word、RTF、ODF 的浏览器保真有限 |
| `pptx/pptm/ppsx` | 有 LO → Moss PDF；无 LO/转换失败 → OFV | OFV 使用 pptx-renderer |
| `ppt/pps/odp` | 有 LO → Moss PDF；无 LO/转换失败 → OFV 基础 | 旧 PPT/ODF 采用基础解析 |
| `xlsx/xls/xlsm/xlsb/ods` | 有 LO → Moss；无 LO → OFV | Moss 窄表转 PDF，宽表保留可滚动 HTML 表格 |
| `csv/tsv` | Moss | 表格预览，保留 Moss 产品操作链路 |
| `dotm/fodt/wps` | OFV 基础 | Moss 未注册这些格式 |
| `xlt/xltx/xltm/fods/et` | OFV 基础 | 模板或兼容表格格式 |
| `ppsm/potx/potm/fodp/dps` | OFV 基础 | 模板、放映或兼容演示格式 |
| `numbers/key` | OFV 结构 | 主要展示包结构、资源或 IWA 概要，不视为完整预览 |

## 文档、文本和图片

| 格式 | 实际路由 | 说明 |
|---|---|---|
| `pdf` | Moss Chromium PDF Viewer | OFV PDF 插件未注册；待产品侧决定是否切换 PDF.js |
| `jpg/jpeg/png/gif/webp/bmp/ico/svg/avif` | Moss Image Viewer | 双支持项，暂不改变现有行为 |
| `tif/tiff` | OFV 完整 | 多页 TIFF、缩放、旋转和拖动 |
| `jfif/pjpe/pjpeg/cur/apng/heic/heif` | OFV 完整 | HEIC/HEIF 在本地转换后展示 |
| `jxl` | OFV 基础 | 实际解码仍取决于 Electron/Chromium |
| `md/markdown` | Moss Markdown Viewer | 保留编辑、保存和历史 |
| `mmd/mermaid` | OFV | Mermaid 图形预览；600 KiB 内仍可切到文本编辑 |
| `lrc` | OFV | 歌词时间轴预览；600 KiB 内可文本编辑 |
| `ipynb` | OFV | Notebook 结构预览；大文件直接从安全文件协议读取 |
| `html/htm` | Moss HTML Viewer | 展示实际页面，而不是 OFV 的源码视图 |
| 网页 URL | Moss Browser Viewer | OFV 的 URL 输入不用于通用网页浏览 |
| `diff/patch` | Moss Diff Viewer | 保留差异视图和编辑链路 |
| 常用代码及配置文本 | Moss Code/Text Viewer | 600 KiB 读取上限，未知 UTF-8 扩展也按文本处理 |

Moss 显式高亮的代码扩展包括：`astro/bash/c/cc/cjs/clj/cljs/cmake/coffee/cpp/cs/css/dart/ex/exs/fish/fs/fsx/go/graphql/gql/groovy/h/hpp/hs/ini/java/jl/js/json/json5/jsx/kt/kts/less/lua/m/make/mdx/mjs/mm/php/pl/pm/proto/ps1/py/r/rb/rs/sass/scala/scss/sh/sql/svelte/swift/toml/ts/tsx/vue/xml/yaml/yml/zsh`。`Dockerfile/Gemfile/Makefile/Procfile/Rakefile/Vagrantfile` 也按代码处理。

## 音视频和容器格式

| 格式 | 实际路由 | 说明 |
|---|---|---|
| `mp4/webm/ogv/mov/m4v` | OFV | Chromium 原生播放；支持 Range 和拖动定位 |
| `mpg/mpeg/mpe/mpv/avi/mkv/wmv/3gp/3g2` | OFV 基础 | 编码不受 Chromium 支持时显示媒体信息和转换提示 |
| `m3u8` | OFV | HLS.js 随 renderer 打包；本地相对分片通过 `moss-media://` 解析 |
| `flv/m2ts` | OFV 基础 | 当前未打包可选的 mpegts.js，提供信息与降级提示 |
| `mp3/wav/aif/aiff/aifc/ogg/oga/aac/m4a/flac/opus/weba/amr/mid/midi/caf/au/snd/wma` | OFV | 原生音频播放；不兼容编码降级为信息和系统打开 |
| `zip/tar/gz/tgz/bz2/xz` | OFV | 解压、目录列表和内部文件预览，最多展示 500 项 |
| `rar` | OFV 结构 | RAR4 可探测部分目录，RAR5 通常只识别容器 |
| `7z` | OFV 结构 | 当前主要展示容器头和元数据 |
| `epub` | OFV | 章节阅读器，最多加载前 40 个 spine 章节 |
| `xps/oxps` | OFV 基础 | FixedPage 转 SVG，复杂字体和透明效果可能降级 |
| `ofd` | OFV 基础 | 文字、路径、图片和印章，最多前 80 页 |
| `eml/msg/mbox` | OFV | 邮件正文、附件和清洗后的 HTML；MBOX 默认前 100 封 |

## 绘图、资产、CAD、3D 和 GIS

| 格式 | 实际路由 | 说明 |
|---|---|---|
| `drawio/dio/excalidraw/tldraw` | OFV 基础 | 轻量 SVG 渲染，特殊图形可能降级 |
| `xmind` | OFV 基础 | 主题、层级和资源；限制 2000 个主题、128 层 |
| `ttf/otf/woff/woff2/eot` | OFV | 字体试排、名称和字体表信息 |
| `psd/psb` | OFV | 合成图和图层信息，不提供图层编辑 |
| `ai/eps/ps` | OFV 结构 | AI 含 PDF 兼容数据时效果更好；EPS/PS 主要是 DSC 信息 |
| `sqlite/sqlite3/db` | OFV 结构 | Schema 和部分数据页样本，不是数据库管理器 |
| `parquet/avro` | OFV | Schema 和有限记录样本 |
| `wasm` | OFV | 模块结构、imports 和 exports |
| `webarchive` | OFV 结构 | plist、主资源信息和片段，不重放网页 |
| `dxf` | OFV 基础 | 基础二维几何 SVG |
| `step/stp/iges/igs/ifc/sat/x_t` | OFV 基础 | 文本结构和部分几何，不保证 B-Rep 保真 |
| `gds/gdsii/oas/oasis` | OFV 基础 | 轻量版图解析和可视化 |
| `dwg/dwf/sab/x_b/3dm/skp/sldprt/sldasm` | OFV 结构 | 默认仅识别或元数据；DWG 未打包可选 WebGL/LibreDWG 引擎 |
| `gltf/glb/obj/stl/fbx/dae/ply/3mf/3ds/usd/usda/usdc/usdz/wrl/vrml` | OFV | Three.js 交互查看；工作区内相对贴图和资源可离线读取 |
| `geojson/topojson/kml/kmz/gpx/shp` | OFV | 本地 Leaflet 样式和矢量数据离线可用；离线时不显示在线 OSM 底图 |

## 离线与打包约束

- 桌面端固定依赖 `@open-file-viewer/core@0.1.45`，由 Vite 编译进 `dist/renderer/assets`，运行时不依赖相邻源码仓库或 npm。
- OFV 样式、Leaflet 样式、HLS、Three.js、Mermaid、Office、邮件、压缩和格式解析依赖均作为本地 chunks 打包。当前生产 renderer 约 22 MB。
- 本地输入使用白名单保护的 `moss-media://workspace/<root>/<relative-path>` 协议。协议支持 HTTP Range、CORS、符号链接逃逸检查和相对资源，不通过 Base64 IPC 复制大文件。
- 远程工作区二进制先下载到进程级临时缓存，再使用同一协议预览；应用退出时删除缓存。
- PDF 继续使用 Moss Chromium Viewer，因此 OFV 的 PDF.js worker、CMap 和字体数据不是当前运行路径，也不需要联网。
- GIS 的 Leaflet CSS 已本地打包；OpenStreetMap 底图属于可选在线数据，断网时矢量、属性和视图操作仍可用。
- 安装包验证会检查 `app.asar` 中确实包含 OFV archive 和 model3d 插件代码，防止发布时丢失动态 chunks。
- OFV 的 MIT 许可文本随安装包写入 `resources/licenses/open-file-viewer.LICENSE`。

## 代码入口

- 格式注册和能力等级：`shared/workspace-preview.mjs`
- OFV React 适配层：`ui/src/renderer-react/components/preview/viewers/OpenFileViewer.tsx`
- 离线文件 URL：`ui/src/renderer-react/components/preview/viewers/offline-preview-url.ts`
- Office 条件路由：`WordViewer.tsx`、`ExcelViewer.tsx`、`PPTViewer.tsx`
- 安全流式协议：`ui/src/media-protocol.mjs`
- 安装包验收：`ui/scripts/verify-package.mjs`
