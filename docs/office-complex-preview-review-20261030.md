# Office 复杂排版预览实测（2026-10-30）

本轮检查当前 Moss 的浏览器内预览链路，普通 Office 文件不调用 LibreOffice。样本来自 `output/office-edge-review/fixtures`，使用真实 React 组件、Vite 文件服务和本机 Chrome；PDF 使用现有 PDF.js 回归脚本。截图和机器结果保存在 [`output/office-complex-preview-review-20261030`](../output/office-complex-preview-review-20261030)、`output/office-edge-review` 和 `output/office-preview-fixes/pdf-validation.json`。

| 类型 | 样本和检查 | 结果 | 结论 |
|---|---|---|---|
| DOCX | 中英文混排、标题、表格、图片、页眉页脚、三段分页；同时用安全文件名和原始特殊文件名测试 | 改为安全文件名后正文、三段标题、表格和 3 张图片均加载，约 5.4 秒；原始文件名含 `#` 时 OFV 报格式未知 | 内容解析可用，但特殊文件名是 P1 缺陷；当前是连续滚动文档，未提供 Codex 风格的稳定分页模型 |
| DOCX | 横版、缺失字体、超长 URL、图片 | 正常加载，缺失字体可回退，长 URL 会换行，图片显示 | 基础预览可用；字体度量和分页未做逐页等价验证 |
| PPTX | 3 页中英文、图片、原生表格、页脚 | 3 页标题、表格、图片和页脚均出现在渲染结果，约 2.2 秒 | 常见静态演示内容可用；当前仍缺少对母版、主题、SmartArt、图表和精确对象定位的验收 |
| PPTX | 竖版 3:4、图片、窄窗口 | 标题和图片正常显示，约 2.1 秒 | 页面比例可用；还没有与 Codex/Office 的像素级基线 |
| XLSX | 30 列宽表、合并标题、3 个工作表、数值矩阵、隐藏页 | 工作表模式加载 1681 个单元格，A1 和 AD13 可定位，3 个工作表可切换，截图中宽表可读，约 3.6 秒 | 工作表内容和定位可用；没有缓存 PDF 时不承诺打印分页、打印区域和页面版式 |
| PDF | 混合页面尺寸、旋转、裁剪、内部/外部链接、超大页面、窄窗口 | 现有 7 项 PDF.js 回归全部通过，包括链接、页内跳转、12000×9000 pt 页面适配和 420 px 窄窗口 | PDF 路线目前最完整，继续沿用 PDF.js |

## 证据和限制

- DOCX 安全文件名的截图为 [`moss-word-mixed.png`](../output/office-complex-preview-review-20261030/moss-word-mixed.png)，横版截图为 [`moss-word-landscape.png`](../output/office-complex-preview-review-20261030/moss-word-landscape.png)。
- PPTX 截图为 [`moss-slides-complex.png`](../output/office-complex-preview-review-20261030/moss-slides-complex.png) 和 [`moss-slides-portrait.png`](../output/office-complex-preview-review-20261030/moss-slides-portrait.png)。
- XLSX 截图为 [`moss-excel-wide.png`](../output/office-complex-preview-review-20261030/moss-excel-wide.png)，原始机器结果为 [`results.json`](../output/office-complex-preview-review-20261030/results.json)。
- PDF 命令为 `PLAYWRIGHT_CHROMIUM_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" bun run test:pdf-preview`，7 项全部通过。
- Office 组件检查没有把“组件 ready”当作“版式正确”：同时检查了正文文本、图片数量、页标题、工作表数量、单元格数量和截图。
- 本轮没有声称已经复刻 Codex 的内部模型，也没有对所有字体、SmartArt、宏、外部链接、数字签名和加密 Office 文件做完整覆盖。

## 决策

当前常见文件的内容展示已经足够支持继续使用浏览器内预览，不需要立即开始完整 .NET/WASM 重写。优先处理特殊文件名、稳定分页/定位和复杂排版回归基线；如果这些基线表明真实文件仍普遍存在分页或对象丢失，再启动 XLSX → DOCX → PPTX 的 OpenXML/WASM proof of concept。TODO 已登记在 [`codex-office-import-architecture.md`](./codex-office-import-architecture.md#todo复杂排版评估后的后续工作)。
