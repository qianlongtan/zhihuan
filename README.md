# 知幻 · PDF 划词翻译

左边读 PDF，鼠标选中就翻译，右边出译文。本地运行，密钥只存自己电脑，可接入 9 家翻译服务。

![界面](docs/screenshot.png)

> 示例：左侧为《Attention Is All You Need》，右侧译文由「讯飞星火 HTTP」实时生成。仅作演示，软件不绑定任何服务商。

---

## 为什么做这个

读英文文献时，最烦的不是「看不懂」，而是**被打断**：选中 → 复制 → 切到翻译网站 → 粘贴 → 读译文 → 切回来 → 找回刚才读到哪。一篇文章下来，注意力被切碎十几次。

知云那类工具解决了流程问题，但多数要么绑定一家翻译、要么把密钥放在别人服务器上、要么只给截图 OCR。知幻想把这几个点都补上：

**1. 本地优先。**
没有账号、没有登录、没有遥测。密钥存在本机 `data/config.json`（权限 600），翻译缓存和标注也在本机。除了「把这段文字发给你选的那家翻译服务」，没有任何数据离开你的电脑。代码全开源，可以自己审计。

**2. 取词靠文本层，不是截图 OCR。**
直接解析 PDF 的文字层，所以能选中、能复制、能跨行跨栏，缩放不失真，也不会有 OCR 错字。代价是扫描件用不了——那就该先 OCR，而不是让翻译工具去猜。

**3. 不绑定任何一家。**
所有服务商走同一套适配器接口，顶栏一键切换。同一段话，可以用免费模型快速扫，也可以用旗舰模型精读；哪家便宜、哪家译得好，自己比。

**4. 翻译不能打断阅读。**
右侧常驻面板、流式输出（第一个字 0.6 秒就出来，不用等整段）、同一个句子第二次翻译直接命中本地缓存、不重复计费。快捷键都在手边。

**5. 读完要能留下痕迹。**
高亮和备忘录直接写回 PDF 标准注释（`/Highlight`、`/Text`），用 Adobe、macOS 预览、Zotero 打开一样能看到。不是私有格式，不锁在某个软件里。

**6. 技术栈故意朴素。**
FastAPI + 原生 JS + PDF.js，没有前端构建步骤。改一行 CSS 刷新就生效，三年后回来还能看懂。这种工具是要用很久的，可维护性比时髦重要。

---

## 功能

- **划词即译**：选中文字，右侧立刻出译文，流式显示
- **整页翻译**：一键翻当前页，自动合并 PDF 断行与断词连字符（`inter-\nnational` → `international`）
- **9 家翻译服务**：免费公共模型、传统机翻、大模型都有，随时切换
- **本地缓存**：同一句不重复请求，省钱也省时间
- **高亮标注**：四色高亮，写进 PDF 标准注释
- **备忘录**：给任意高亮加笔记，存本机并在下次打开时自动恢复
- **长文档友好**：虚拟滚动，几百页也不会卡死
- **记住习惯**：缩放、面板宽度、语言对、自动翻译开关

---

## 快速开始

需要 **Python 3.10+**（Windows 安装时记得勾选 `Add Python to PATH`）。

**Windows**

```
双击 start.bat
```

**macOS / Linux**

```bash
chmod +x start.sh
./start.sh
```

首次运行会自动创建虚拟环境并安装依赖（约 20 MB，只装进项目目录，不污染系统）。完成后浏览器会自动打开 `http://127.0.0.1:8765`。

> 没有图形界面的服务器上，程序只打印地址，自己用浏览器访问即可。端口被占用时会自动往后找。

### 开箱即用，零配置

默认选中 **B站 Index-Translate**——哔哩哔哩开源的翻译模型公共 API，**不需要任何密钥**，注册都不用。装上就能划词翻译，适合先体验。

觉得质量不够，再去配下面的商业服务；两者可以随时在顶栏切换。

---

## 配置翻译服务

点右上角 **齿轮 → 选一张卡片 → 填字段 → 测试连接 → 保存**。

- 密钥字段显示为圆点，保存后只留一句「已保存」；**留空表示不修改**，不会把已存的密钥清掉。
- 每家都有「测试连接」，会当场返回耗时和一句示例译文，填错了一眼能看出来。
- 可以同时配好多家，顶栏下拉随时切换，不用反复输密钥。

### 各服务商怎么填

| 服务商 | 需要填写 | 去哪儿拿 | 建议 |
|---|---|---|---|
| **B站 Index-Translate** | 无需填写 | 无 | 免费，2B/9B/35B 三档 |
| **智谱 GLM** | API Key | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/apikeys) | `glm-4.5-flash` 有免费额度 |
| **讯飞星辰 MaaS** | APIKey + 模型 ID | [console.xfyun.cn](https://console.xfyun.cn) 模型广场 | 需先「订购」模型才可用 |
| **讯飞星火 HTTP** | APIKey + APISecret | [xfyun.cn](https://www.xfyun.cn) 星火控制台 | 注意：**不需要** APPID |
| **讯飞星火 WebSocket** | APPID + APIKey + APISecret | 同上 | `lite` 免费 |
| **小牛翻译** | API Key（可选 AppId） | [niutrans.com](https://niutrans.com) | 有 AppId 会自动走新版接口 |
| **火山翻译** | AccessKey + SecretKey | 火山控制台 → 机器翻译 | 注意：**不是** API Key |
| **百度翻译** | APP ID + 密钥 | [fanyi-api.baidu.com](https://fanyi-api.baidu.com) | 免费版 1 QPS |
| **自定义 OpenAI 兼容** | Base URL + Key + 模型 | 自备 | DeepSeek / Kimi / Ollama 等 |

#### 智谱 GLM

1. 打开 [API Keys 页面](https://open.bigmodel.cn/usercenter/apikeys)，注册后创建密钥，形如 `xxxxxxxx.yyyyyyyy`
2. 软件里选「智谱 GLM」，把整串粘进 **API Key**
3. 模型填 `glm-4.5-flash`（免费额度，速度快）或 `glm-4-flash`

#### 讯飞星辰 MaaS

1. 登录 [讯飞开放平台控制台](https://console.xfyun.cn)，进「模型广场」
2. **先订购模型**（例如 `spark-x2.6-4b`），否则调用会返回 `11200 无有效订单`
3. 在「服务管理 / APIKey」里拿 APIKey
4. 软件里填 **APIKey** + **模型 ID**（必须和控制台里显示的完全一致）
5. Base URL 默认是 `/v2`；2026-01-10 之前开通的旧账号如报 404，改成 `/v1`

#### 讯飞星火 HTTP

这是星火开放平台的 HTTP 接口，和 WebSocket 版不是一回事：

- 需要 **APIKey** 和 **APISecret**（在星火控制台「服务接口认证信息」里）
- **不需要 APPID**，也不要填成 WebSocket 那套
- 模型：`lite`（免费）/ `generalv3.5` / `4.0Ultra`
- 鉴权方式是 `Bearer APIKey:APISecret`，软件已自动拼接

#### 讯飞星火 WebSocket

- 需要 **APPID + APIKey + APISecret** 三件套，缺一不可
- 模型 `lite` 免费；`generalv3.5`、`4.0Ultra` 需付费
- 走 WebSocket 流式，首字延迟比 HTTP 略低

#### 小牛翻译

1. [niutrans.com](https://niutrans.com) 注册，进控制台拿 **API Key**
2. 只填 API Key 即可（旧版接口）
3. 如果控制台给了 **AppId**，一并填上——软件会自动切到新版 v2 签名接口，更稳定

#### 火山翻译

1. 火山引擎控制台先**开通「机器翻译」服务**（不开通会报 `100009 InvalidAccessKey`）
2. 在 IAM 里创建 **AccessKey / SecretKey**（不是「API Key」，两者不通用）
3. 软件里分别填 **AccessKey**、**SecretKey**，区域保持 `cn-north-1`

#### 百度翻译

1. [百度翻译开放平台](https://fanyi-api.baidu.com) 申请「通用翻译」，拿到 **APP ID** 和**密钥**
2. 软件里填这两项即可
3. 免费版限 **1 QPS**，快速连续划词可能被限流（报 `54003`）；长文本会自动按句切块（单次上限 6000 字节）

#### 自定义 OpenAI 兼容

任何说 OpenAI 协议的服务都能接：

| 服务 | Base URL | 模型 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | 任意上架模型 |
| 本地 Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` |
| 本地 vLLM | `http://127.0.0.1:8000/v1` | 你部署的模型名 |

Base URL 填到 `/v1` 即可，软件会自动补 `/chat/completions`；直接粘贴完整地址也认。

---

## 使用

### 划词翻译

1. 点顶栏「打开」，或把 PDF 拖进窗口
2. 鼠标选中英文（可跨行）
3. 右侧面板流式出译文

选中后会浮出工具条：四个颜色点用于高亮，最右的便签图标用于写备忘录。

> 跨页选择时，只翻译当前页内的部分；双栏论文的整页翻译按 PDF 内部顺序拼接，偶尔会把两栏接在一起——这是 PDF 文本层本身的顺序，不是翻译错误。

### 高亮与备忘录

- 选文字 → 点颜色 → 生成高亮
- 点便签图标 → 写备注 → `Ctrl+Enter` 保存
- 高亮和备注同时存两处：**PDF 文件内**（标准注释）和**浏览器 IndexedDB**（打开同一文件时自动恢复）
- `Ctrl+S` 保存：
  - 用**「打开」按钮**并选文件时，Chrome / Edge 能直接覆盖原文件
  - 拖拽打开、或用 Firefox / Safari 时，会弹出「另存为」，默认填原文件名，选中原文件即可替换
  - 想固定覆盖某个文件：第一次另存时选中它，之后 `Ctrl+S` 就不再弹窗

### 快捷键

| 按键 | 作用 |
|---|---|
| `Ctrl + O` | 打开 PDF |
| `Ctrl + S` | 保存标注（覆盖或另存） |
| `Ctrl + 滚轮` | 缩放 |
| `Ctrl + Enter` | 保存当前备忘录 |
| `Ctrl + Shift + H` | 切换笔记面板 |
| `Esc` | 关闭弹层 |

---

## 常见问题

**扫描件翻不了？**
PDF 里必须有文字层（能选中文字）。纯图片扫描件请先用 [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) 之类做 OCR，本项目不含 OCR。页面没有文字层时界面会提示。

**报 412，或返回一堆 HTML？**
B站公共接口会拦默认 User-Agent。软件已内置正确的 UA；如果你改了适配器或用了自己的反向代理，记得带上非默认 UA。

**报 401 / 100009 / 20001？**
密钥不对，或服务没开通。火山要单独开通「机器翻译」；讯飞 MaaS 要单独「订购模型」；小牛的 key 分新旧两套接口，有 AppId 时会自动走新版。

**翻译很慢？**
大模型（尤其 35B、GLM-4.5）本身就比传统机翻慢。日常划词建议选 B站 9B、星火 `lite`、智谱 `glm-4-flash` 这类；精读再切 35B。整页翻译因为文本长，等十几秒是正常现象。

**整页翻译被截断？**
单次请求上限 20000 字符。LLM 适配器已把 `max_tokens` 调高；如果仍被截断，多半是服务商侧的输出上限，换服务商即可。

**公司网络要走代理？**
默认直连，不读系统代理变量。需要代理时，把 `backend/adapters/` 里的 `trust_env=False` 改成 `True`。

**端口被占用？**
`run.py` 会从 8765 往后找空闲端口，启动日志里会打印实际地址。

---

## 隐私

- 密钥存在 `data/config.json`，文件权限 `600`，不上传、不同步
- 翻译缓存存在 `data/cache.db`，只在本机
- 标注存在 PDF 文件内 + 浏览器 IndexedDB
- 唯一的外发流量：你选中/整页的文字 → 你当前选中的那家翻译服务
- 没有统计、没有崩溃上报、没有远程配置

备份就拷整个文件夹；删除文件夹即彻底卸载。**别把带 `data/` 的目录发给别人——里面有你的密钥。**

---

## 技术栈与结构

```
zhihuan/
├── start.sh / start.bat     # 启动脚本（自动建环境）
├── run.py                   # 起服务 + 开浏览器
├── backend/
│   ├── main.py              # HTTP 接口（翻译 / 流式 / 设置 / 缓存）
│   ├── config.py            # 服务商字段定义与配置读写
│   ├── cache.py             # SQLite 翻译缓存
│   ├── textprep.py          # PDF 文本清洗（断行、连字符、空格）
│   └── adapters/            # 每家翻译服务一个适配器
│       ├── base.py          # 基类 + 翻译提示词
│       ├── openai_compat.py # OpenAI 协议通用实现
│       ├── index_translate.py
│       ├── niutrans.py
│       ├── volc.py
│       ├── spark.py
│       ├── baidu.py
│       └── mock.py
├── static/                  # 前端（无构建步骤）
│   ├── app.js               # 顶栏 / 打开文件 / 保存 / 快捷键
│   ├── pdfview.js           # PDF.js 渲染 + 虚拟滚动 + 划词
│   ├── panel.js             # 译文面板 + SSE
│   ├── annot.js             # 高亮 / 备忘录 / IndexedDB
│   ├── pdfannot.js          # 把注释写进 PDF（pdf-lib）
│   ├── settings.js          # 设置页
│   └── vendor/              # PDF.js 与 pdf-lib（已内置，离线可用）
└── data/                    # 运行时生成：配置 + 缓存
```

- 后端：FastAPI + httpx + uvicorn
- 前端：原生 ES Module，PDF.js 4.10、pdf-lib 1.17（均已本地化，不依赖 CDN）
- 服务端只做三件事：保管密钥、代签各家的鉴权、转发流式响应

---

## 加一家新的翻译服务

1. 在 `backend/adapters/` 新建文件，继承 `BaseAdapter`，实现
   `async def translate(self, text, src, tgt) -> str`（想流式再实现 `stream`）
2. 在 `backend/adapters/__init__.py` 的 `REGISTRY` 和 `NAMES` 里注册
3. 在 `backend/config.py` 的 `PROVIDERS` 里加一段字段定义

设置页会根据 `fields` 自动渲染表单，不用改前端。

---

## 已知限制

- 扫描件不支持（无文字层），需要先 OCR
- 旋转页（`/Rotate` 90/180/270）的高亮坐标未做换算
- 加密 PDF 拒绝写入注释
- Firefox / Safari 无法原地覆盖原文件，只能另存
- B站公共 API 无 SLA，高峰期可能变慢或限流
- 双栏 PDF 的整页翻译按文本层顺序拼接，偶尔跨栏粘连

---

## License

MIT
