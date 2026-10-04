# 大文档所见即所得输入延迟：定位与方案

## 结论

当前输入只改动一个段落，却会周期性触发与**整份文档长度、块数和页数**有关的同步、DOM 布局和后台分析。已有的块缓存减少了重复序列化和解析，但全文拼接、比较、事件传输和浏览器布局仍然存在。文件越大，WebView 主线程越容易在下一次输入前被这些工作占用。

桌面通信另有已复现的硬限制：Cargo.lock 实际解析到 Dioxus 0.7.3，其输入事件编码用 `String.fromCharCode.apply(null, contents_bytes)` 一次传入全文 UTF-8 字节。当前 WebKitGTK 2.52.6 中，1,573,015 字节的合成事件触发 `RangeError: Maximum call stack size exceeded`，在调用 XHR.send 之前失败。这会使全文同步失败；它与输入延迟都需要处理。

尚未测到用户实际文件在完整桌面应用中各部分的占比，不能把某一个环节宣称为唯一瓶颈。

## 实测：按键至下一次绘制机会

使用相同合成中文短段落文档，每 80 ms 输入一次 `x`，每个场景 24 次；分别在文首、文尾以及分页、无缝视图测试。采用原生浏览器按键事件，不使用直接插入 ProseMirror 事务代替输入。

下表是分页视图文首结果，单位 ms：

| 源码 UTF-8 字节 | 顶层块数 | WebKit P50 / P95 |
| --- | ---: | ---: |
| 97,378 | 320 | 9 / 10 |
| 388,559 | 1,274 | 12 / 13 |
| 1,553,639 | 5,093 | 21 / 22 |

1.55 MB 文档的 WebKit 无缝视图文首 P50 / P95 为 **20 / 22 ms**；文尾分页为 **20 / 22 ms**。关闭分页仍然随文件大小变慢。普通输入事务 P50 约 2 ms，而全文同步 `flushChange` 和测量工作区更新各占数毫秒。这些时间相互嵌套，不能直接相加。更早的 Chromium 测量也观察到同样的规模增长趋势。

全部 12 个 WebKit 场景（共 288 次输入）及 5 个编码大小的原始阶段数据保存在 [input_latency_baseline.json](./input_latency_baseline.json)。脚本在复用页面容器时清除旧会话的分页状态，确保开始计时前本次初始分页已完成；每个场景检查确实收到了 24 次输入。

### 测量范围

- `keydown.timeStamp` 到 `requestAnimationFrame` 后的下一次任务作为绘制机会近似值。没有测硬件击键到屏幕像素呈现的完整延迟。
- 测试使用真实共享 CodeMirror 历史会话，**没有 Dioxus textarea 事件接收方和 Rust 工作区**，因此未包含同步 IPC、Rust 解码、组件重绘、字数和大纲分析。
- WebKit 使用 GTK3 / WebKit2 4.1 / Broadway，禁用合成；用于定位本机编辑器开销，不等价于用户桌面窗口的全部表现。
- 合成文档没有图片、公式、嵌入字体或巨型单段落。24 次采样足以观察趋势，不能代表所有内容和设备的延迟分布。
- WebKit 不支持本测试使用的 Long Tasks API。空长任务数组不表示没有阻塞。
- 最小完整 Dioxus 桌面诊断窗口在本环境初始化未完成，故没有可报告的真实 IPC 往返数值。

## 代码中的放大路径

### 1. 全文同步在连续输入期间反复发生

`bridge/session.js` 的 `scheduleChange()` 在已有定时器时直接返回，不会重置等待时间。名为 `changeDebounceMs = 120` 的机制实际在连续输入时周期性执行，并非等待用户停下 120 ms。

`flushChange()` 执行以下路径：

```text
ProseMirror 文档
  → MarkdownProjection.snapshot：遍历所有顶层块并拼接全文
  → InfiniteMarkdownEditor.replaceAll：取出旧全文、前后缀比较
  → CodeMirror 更新共享历史
  → emitChange：再次取出全文、JSON.stringify、设置 textarea.value
  → dispatchEvent(input)
  → Dioxus 事件 JSON → UTF-8 → base64 → 同步 XHR
  → Rust 事件解码 → MarkdownChangeEnvelope 解码 → 更新文档 Signal
```

具体位置：

- `web/wysiwyg/bridge/session.js`：`scheduleChange`、`flushChange`、`captureHistoryStart`。
- `web/wysiwyg/markdown/projection.js`：`snapshot`，即便未变块有缓存，每个新文档仍遍历所有块并 `chunks.join('')`。
- `web/editor.js`：`replaceAll` 使用 `controller.state.doc.toString()` 后做 `minimalTextChange`；`emitChange` 再生成完整 Markdown 事件。
- 当前依赖 `dioxus-interpreter-js-0.7.3/src/ts/native.ts`：`sendSerializedEvent`、`handleVirtualdomEventSync` 使用 `xhr.open('POST', endpoint, false)`，WebView 等待 Rust 事件处理结束。
- `src/components/word/workspace.rs`：`on_markdown_change` 二次 JSON 解码、全文比较/复制、更新响应式文档。

块缓存不意味着通信或字符串处理已经增量化。首次同步还可能为未缓存的全部块创建序列化缓存；非规范 Markdown 的映射回退会重新解析全文。

### 2. Rust 文档更新扩大到整个工作区

- `workspace.rs` 每次重新渲染执行 `document()` 克隆整个 ProjectDocument；`count_source` 复制全文并启动完整 Markdown 解析来统计可见字符。
- `outline.rs` 每次全文更新重新解析大纲。每个标题的偏移又执行 `source[..byte].encode_utf16().count()`，有 H 个标题时最坏为 O(H × 文档长度)。此前 AST 位置转换修复过同类问题，大纲仍保留这条重复扫描路径。
- 桌面字数、大纲分析已在后台线程执行，不能把它们描述成直接在 WebView 上运行。但运行中的旧任务不能中途取消，两个工作线程仍可能持续占用 CPU；准备字符串和组件重绘也有成本。
- `prosemirror_surface.rs` 随文档 Signal 更新复制 Markdown 并重新生成嵌入字体 CSS。带字体资源的 EPUB 需要单独测量，这项在无资源合成测试中没有覆盖。

### 3. 分页缓存仍要面对整份 DOM

- `plugins/pagination.js` 编辑等待为 80 ms，并以 250 ms 限制持续延后；连续输入也会开始分页。
- `measurement_snapshot.js` 使用完整文档的第二个 EditorView，更新后读取浏览器几何。
- `measuredLayout` 遍历所有块；`paintPageGaps` 为全部页缝读取 `getBoundingClientRect()`，之后才裁剪到视口附近。
- 单次 DOM reconciliation / 浏览器布局不能被 6 ms 协作检查点抢占。活动编辑 DOM 和测量 DOM 都随文档增大；只有页缝外观进行了视口裁剪。

## 建议的修复顺序

### 第一阶段：替换输入同步协议，消除全文事件限制

1. 把输入通知改成有版本号的局部修改：`document_revision`、`base_edit_revision`、`edit_revision`、UTF-16 范围、插入文本、选区及来源。接收方只接受连续版本；遇到缺口要求快照恢复，禁止静默覆盖。
2. 从变动的顶层块生成 Markdown 修改，维护块偏移索引；避免先拼全文再扫描差异。处理块间分隔符、列表合并、删除、拆分以及非规范原始 Markdown。巨型单块仍需单独限制成本。
3. 使用 Dioxus 的异步 `document::eval` send/recv 通道传递修改并确认接收，避免把全文塞进同步 FormEvent。应使用项目现有 `javascript::eval_reply` 的查询存活/确认机制；大快照分片、排序并支持取消，不能改走另一个仍使用大参数 `apply` 的通道。
4. JS 共享文档会话继续即时维护历史和未保存状态；Rust 镜像异步跟进。普通插入的小包大小应与修改量有关。
5. 保存、导出、切换模式、关闭文档必须等待确定版本的修改应用完成，再取得一次一致快照。输入法组合期间不投影半成品；保留选区和跨视图撤销/重做。

Rust 若继续用一个 String 镜像全文，应用局部修改仍可能移动长后缀。因此需要 Rope / piece tree 和共享不可变快照，或明确仅在显式保存时物化完整字符串。仅缩小 IPC 包不能宣称全部工作已与文件长度无关。

### 第二阶段：把衍生信息与输入解耦

- 对普通输入做真正的空闲合并，同时用轻量版本/dirty 通知保证未保存状态及时可见；保存和历史命令继续强制完成同步。不能简单增加定时器后依赖 Rust 中的旧正文保存。
- 字数、大纲按变动块更新，复用同一份解析结果；全局格式/解析规则改变再重建。大纲 UTF-16 偏移先改为一次线性扫描，移除重复前缀扫描。
- 后台只保留最新请求，运行中的解析提供取消检查点。旧结果不得覆盖新版本。
- 将正文、标题、布局、资源、页码等响应式依赖分开。工具栏/页码变化不复制正文；字体 CSS 只随布局及资源改变重算。

### 第三阶段：局部重新分页

- 从最早受影响的块/页开始计算，直到页边界和剩余高度与旧结果重新一致。输入优先更新光标附近，后续页面分片完成并保留最后有效分页。
- 根据缓存的页位置先找视口范围，再只读取该范围的页缝几何；避免每次滚动遍历所有页缝。
- 为极大文档引入编辑块虚拟化或章节工作区。必须专门设计跨块选区、查找、IME、表格跨页与历史；不能仅隐藏 DOM 后宣称解决。

release 构建可以降低 Rust 调试开销，但上述全文处理、同步传输限制和 DOM 增长仍需结构性修改。

## 验收与复现

```sh
# Chromium 原生按键、编辑器内阶段计时
node scripts/profile-input-browser.mjs

# Linux WebKitGTK；使用系统 Python，需 GI / GTK3 / WebKit2 4.1 / broadwayd
/usr/bin/python3 scripts/profile-input-webkit.py

# 从 Cargo 缓存中找到当前版本 src/js/native.js，验证其发送前编码
/usr/bin/python3 scripts/profile-input-webkit.py --bridge-encoding /absolute/path/to/native.js
```

编码测试调用依赖自带 JS 的原始 `handleVirtualdomEventSync`；仅替换 XHR 为桩，避免网络请求。测试每个大小 10 次。98,455、196,759、393,367 字节成功；1,573,015 字节失败。这里只报告采样边界，没有定位所有引擎上的精确上限。

结果输出到各自的 `/tmp/infinite-*-input-*/report.json`。Broadway 默认显示号 17 / 端口 18097；发生冲突时可用 `--display` / `--port` 指定未使用的值。完整桌面验收须另行测量 **按键 → 事务 → 投影 → IPC → Rust 更新 → 绘制机会**，保留每个阶段和总耗时，不能仅测 ProseMirror dispatch。

修复验收包含：不同长度文档、文首/中部/尾部、巨型段落/列表、字体/公式/图片、中文组合输入、快速连续输入、撤销/重做、模式切换、立即保存、旧版本拒绝和快照恢复。先记录完整桌面基线，再在同一构建/硬件上比较 P50 / P95、长任务、同步字节数以及全解析次数。普通按键不得发送全文或启动两次全文解析；编码不得在大快照处失败。

既有 `test-pagination-performance` 不含桌面 IPC 和 Rust 更新，不能用其通过作为本问题已经修复的证据。本次提交的是诊断入口与修复设计，生产输入协议尚未改动。
