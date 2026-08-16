# 联网信息查询助手：免费搜索/天气/新闻 API 选型报告（中国大陆直连视角）

> 调研时间：2026 年（基于 2025–2026 资料）
> 适用场景：macOS 桌面应用（Electron + Node.js，用户在中国大陆网络环境），实时检索网页 → 注入 LLM 上下文后综合回答。
> 结论速览：**搜索主推博查 BochaAPI（国内直连、免费额度、按量便宜）；天气用 Open-Meteo（免费无 key）；新闻不单独接 API，直接用搜索 API 检索 + RSS 兜底。经典 Bing Web Search API 已于 2025-08-11 停服，不要再接入。**

---

## 0. 最重要的背景变化（先看这个）

**经典 Bing Web Search API（Azure Cognitive Services，`api.bing.microsoft.com`）已于 2025 年 8 月 11 日正式停用**，微软官方生命周期公告见 [Bing Search API retirement](https://learn.microsoft.com/zh-cn/lifecycle/announcements/bing-search-api-retirement)。配套的 Bing News API / Bing Visual Search 一并退役，替代品是 Azure AI Foundry 的 **Bing.Grounding**（与大模型 grounding 绑定）和 Azure AI Agent Service 内置联网搜索。市面上大量 2023–2024 年教程里"F0 免费 1000 次/月 + `Ocp-Apim-Subscription-Key`"的写法**已经失效**，新 Bing.Grounding 免费层额度与老 F0 不同且注册门槛更高（Azure 账号 + 国际信用卡验证），国内直连无官方保证。**结论：Bing 官方 API 从本项目候选名单中剔除。**

---

## 1. 方案总览对比表

| API / 方案 | 免费额度 | 中国大陆可直连？ | Key 获取成本 | 请求格式 | 适合度 |
|---|---|---|---|---|---|
| **博查 BochaAPI**（国内） | 注册送免费资源包（约千次级/月，具体以官网为准） | ✅ 国内直连稳定（国内服务） | 极低：邮箱注册即可，手机号实名，无需信用卡 | POST + Bearer Token | ⭐⭐⭐⭐⭐ 主推 |
| **腾讯云 WebSearchMCP**（国内） | 新用户免费试用额度，超出按量计费 | ✅ 国内直连 | 低：腾讯云账号 + 实名认证 + 开通 MCP 服务 | POST + SecretId/SecretKey 签名 | ⭐⭐⭐⭐ 备选 |
| **Open-Meteo 天气** | 完全免费、无 key（非商业用途；有公平使用政策） | 🟡 一般可直连，偶有波动（服务器海外） | 零 | 纯 GET | ⭐⭐⭐⭐⭐ 天气主推 |
| 和风天气 QWeather（国内） | 免费订阅版每日约 1000 次 | ✅ 国内直连 | 低：注册送 key | GET | ⭐⭐⭐⭐ 天气备选 |
| **Brave Search API** | 免费层 2000 次/月（1 QPS） | 🟡 不保证，多数需代理 | 低：邮箱注册，无需信用卡 | GET + X-Subscription-Token | ⭐⭐⭐ 海外/代理环境 |
| **Serper.dev** | 注册送 2500 次**一次性**免费额度（非每月） | 🟡 不保证，常需代理 | 低：邮箱注册 | POST + X-API-KEY | ⭐⭐ 仅作一次性试用 |
| **SerpAPI** | 免费层 100 次/月（仅开发用） | 🟡 不保证，常需代理 | 低：邮箱注册 | GET + api_key 参数 | ⭐⭐ |
| DuckDuckGo Instant Answer API | 免费无 key | ❌ duckduckgo.com 被墙，api.duckduckgo.com 不可直连 | 零 | GET | ⭐ 仅瞬时答案，国内不可用 |
| DDGS（python-duckduckgo-search） | 免费无 key（爬取 HTML） | ❌ 被墙；且是 Python 库，Electron 内不可直接用 HTTP 方案 | 零 | 库调用 | ⭐ 国内不可用 |
| SearXNG 公共实例 | 免费无 key（JSON API） | ❌ 实例多在欧美，国内直连慢/被 Cloudflare 挡；多数实例禁用 JSON API | 零（自建需 VPS） | GET /search?format=json | ⭐ 不适合应用调用 |
| 百度/360/搜狗官方搜索 API | 百度仅千帆 AppBuilder「智能搜索生成」（按量计费，个人门槛高）；360/搜狗无公开免费 API | ✅ | 高 | — | ⭐ 不推荐 |
| NewsAPI.org | 免费层 100 次/天，**2024 年起仅限开发环境（localhost），生产必须付费** | 🟡 可访问但偶不稳定 | 低 | GET | ⭐ 不推荐用于桌面应用 |
| GNews | 免费层 100 次/天 | 🟡 可访问但偶不稳定 | 低 | GET | ⭐ 新闻专用可选 |
| cn.bing.com 页面抓取（必应国内版） | 免费（非官方，属爬取） | ✅ 国内直连（cn.bing.com 正常访问） | 零 | GET 页面 + HTML 解析 | ⭐⭐ 零成本兜底，脆弱 |

> 🟡 = 技术上不在 GFW 明确名单内、多数时候能连通，但**无任何官方 SLA**，稳定性/时延不可控，不建议作为唯一依赖。

---

## 2. 逐项调研详情

### 2.1 Bing Web Search API（Azure）——已停服，仅作避坑记录

- **现状**：经典 Bing Search v7 API 已于 **2025-08-11 停用**（[微软生命周期公告](https://learn.microsoft.com/zh-cn/lifecycle/announcements/bing-search-api-retirement)）。新方案是 Azure AI Foundry 的 Bing.Grounding / Azure AI Agent Service，接口与老 API 不是 drop-in 替换（[firecrawl 的替代指南](https://www.firecrawl.dev/blog/bing-search-api-alternatives)）。
- **历史额度**：老 F0 免费层 1000 transactions/月、3 QPS（[微软 Q&A 确认曾有免费层](https://learn.microsoft.com/en-ie/answers/questions/5538194/is-there-any-free-plan-for-bing-search-api)）。
- **注册门槛**：Azure 账号需要手机 + **国际信用卡/借记卡验证**（[微软 Q&A 讨论免费试用用借记卡问题](https://learn.microsoft.com/en-sg/answers/questions/5947485/do-microsoft-accept-the-azure-free-trial-through-d)），中国大陆用户无外币卡时注册失败率高，常需第三方虚拟卡（有合规与封号风险）。
- **国内可访问性**：`api.bing.microsoft.com` 历史上被部分中文开发者报告"无需魔法可用"（[参考](http://www.chinadongda.com/j/?ph12345687/article/details/139102590)），但微软对国内无承诺，且 2023 年 Bing API 大幅涨价（[The Register](https://www.theregister.com/software/2023/02/20/rely-on-microsoft-bing-search-apis-price-hike-incoming/516017)）。
- **结论**：不再接入。国内替代见博查/腾讯云。

### 2.2 博查 BochaAPI（国内，主推）

- 官网：open.bochaai.com；国内 AI 搜索 API，返回结果已带 AI 摘要（`summary` 字段），**专为 LLM 上下文设计**，被广泛用作 Bing API 的国内平替（[掘金接入教程](https://juejin.cn/post/7425420976487809062)）。
- **免费额度**：注册即送免费额度，官方提供"免费领取调用资源包"入口（[博查飞书文档](https://bocha-ai.feishu.cn/wiki/RWdvw557Li3IJekGeLkcDFa3n1f)、[CSDN 介绍](https://blog.csdn.net/weixin_42531752/article/details/151585031)），额度量级约千次/月，超出后按量计费（价格远低于 SerpAPI，个人使用成本可忽略）。**以官网当前套餐为准。**
- **Key 获取**：邮箱注册 → 控制台生成 API Key（`sk-...`），无需信用卡；国内服务，无支付障碍。
- **国内直连**：✅ 本身就是国内服务，无墙问题。
- **风险**：免费额度需留意到期/消耗；属于第三方聚合搜索，中文结果质量好，英文/小众结果一般。

### 2.3 腾讯云 WebSearchMCP（国内备选）

- 腾讯开源了 [Tencent/WebSearchMCP](https://github.com/Tencent/WebSearchMCP)，腾讯云"联网搜索 MCP（标准版）"通过 MCP 协议/HTTP 调用，底层是腾讯自研搜索（搜狗并入腾讯后的搜索能力）。
- **额度**：新用户有免费试用额度，超出按量计费（价格以腾讯云控制台为准）。
- **Key 获取**：腾讯云账号 + **实名认证**（身份证/银行卡验证），控制台开通"智能搜索增强"服务拿 SecretId/SecretKey。
- **国内直连**：✅。
- **风险**：实名认证是硬门槛；MCP 协议面向 Agent 场景，裸 HTTP 调用需按腾讯云签名规范做 HMAC，接入复杂度略高于博查。

### 2.4 Brave Search API

- 免费层 **2000 次/月、1 QPS**（[Brave 官方定价](https://brave.com/zh/search/api/guides/what-sets-brave-search-api-apart/)、[requestly 文档](https://requestly.com/api-explorer/brave-search/)）。
- **Key 获取**：邮箱注册即得，无需信用卡。
- **国内直连**：🟡 Brave 官网/搜索在境内访问不稳定，`api.search.brave.com` 无国内节点，多数用户需代理；免费层明确"仅个人/开发用途，禁止生产与再分发"。
- **风险**：免费层有"不得用于生产"条款；国内直连无保证。适合作为**海外环境或代理环境**的备选。

### 2.5 SerpAPI / Serper.dev

| | SerpAPI | Serper.dev |
|---|---|---|
| 免费额度 | **100 次/月**（仅开发，[定价页](https://serpapi.com/pricing)） | **2500 次一次性**（注册即送，[Serper](https://www.buildmvpfast.com/alternatives/serper)） |
| Key | 邮箱注册 | 邮箱注册 |
| 国内直连 | 🟡 常需代理 | 🟡 常需代理 |
| 付费 | $75/月起（贵） | $50/月 5 万次（便宜） |

- 两者本质都是 **Google SERP 代理**，返回 Google 搜索结果。对中文用户价值一般（Google 在国内不可用，但 API 走的是服务商自己的服务器，不依赖本机访问 Google）。
- **风险**：直连不保证；SerpAPI 免费额度极小；Serper 一次性额度用完即无。适合快速原型验证，不适合作为正式依赖。

### 2.6 DuckDuckGo（Instant Answer API + DDGS）

- **Instant Answer API**：`https://api.duckduckgo.com/?q=...&format=json&no_html=1`，免费无 key（[OpenAPI 定义](https://raw.githubusercontent.com/api-evangelist/duckduckgo/refs/main/openapi/instant-answer-openapi.yml)）。**能力非常有限**：只返回"瞬时答案"（定义、计算、百科摘要），普通查询返回空 `AbstractText`，**不能当通用搜索用**。
- **DDGS**（python-duckduckgo-search）：爬取 DuckDuckGo HTML 结果，免费无 key。**两个致命问题**：① duckduckgo.com 在国内被墙，直连不可用；② 它是 **Python 库**，Electron/Node 应用无法直接以 HTTP 方案调用（需另起 Python 子进程或自建服务）。
- 另有 DDG 反爬限流问题（429/验证码，需代理与降频，[DeepWiki 代理配置文档](https://deepwiki.com/deedy5/duckduckgo_search/5.1-proxy-configuration)）。
- **结论**：国内项目直接排除；仅作海外环境的免费兜底。

### 2.7 SearXNG 公共实例

- 自建 SearXNG 提供 JSON API：`GET https://<host>/search?q=...&format=json`（[官方 Search API 文档](https://docs.searxng.org/dev/search_api)）。
- **公共实例不适合应用调用**：① 实例几乎都在欧美，国内直连慢且常被 Cloudflare 拦截；② 多数公共实例**默认禁用 JSON API 或要求 token**（防滥用）；③ 实例可靠性差、随时可能关闭/限流（[SearXNG 可靠性讨论](https://scavio.dev/glossary/searxng-reliability)）。
- 若一定要用，正确姿势是**自建**（Docker 部署在自己的海外 VPS 上），成本与维护属于另一话题，不推荐在桌面应用里直接依赖公共实例。

### 2.8 国内官方方案（百度/360/搜狗/阿里）

- **百度**：没有面向个人的通用网页搜索 API。百度智能云千帆有「智能搜索生成」（AppBuilder/千帆，[文档](https://cloud.baidu.com/doc/qianfan/s/Hmbu8m06u)），按量计费、面向企业、需企业资质/实名认证，个人项目门槛高。
- **360 / 搜狗**：无公开免费搜索 API。
- **阿里云**：OpenSearch 是企业级搜索服务（贵）；百炼平台有联网搜索插件但按次计费、以企业开通为主。
- **结论**：国内"官方"搜索引擎 API 均不对个人免费开放，**个人项目首选第三方国内聚合 API（博查）**。

### 2.9 Open-Meteo 天气 API（免费无 key，确认可用）

- 官方定位：**非商业用途完全免费、无需 API Key**，有公平使用政策（合理频率下不限制；商业用途建议查看条款/捐助）（[Open-Meteo 文档](https://open-meteo.com/en/docs)、[GitHub](https://github.com/Demiseman/open-meteoAPI)）。
- **地理编码 API**（城市名 → 经纬度，支持中文）：
  `GET https://geocoding-api.open-meteo.com/v1/search?name=北京&count=5&language=zh&format=json`
  返回 `results[].{name, latitude, longitude, country}`。
- **天气预报 API**：
  `GET https://api.open-meteo.com/v1/forecast?latitude=39.90&longitude=116.40&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai`
  返回 `current`（实时）、`daily`（逐日）、`hourly`（逐小时）等，`weather_code` 为 WMO 天气代码。
- **国内可访问性**：🟡 服务器在海外但通常可直连，偶有抖动；**务必做超时/重试 + 缓存**。
- **国内备选**：和风天气 QWeather（免费订阅版，国内直连稳定，需注册 key）；高德开放平台天气（免费，需 key）。

### 2.10 新闻 API（GNews / NewsAPI）

- **NewsAPI.org**：免费层 **100 次/天**，但 **2024 年 7 月起免费层仅允许本地开发环境（localhost）使用，生产必须付费**（[Thunderbit 新闻 API 对比](https://thunderbit.com/zh-Hans/blog/best-news-apis-compared)）→ 桌面应用**不可用**。
- **GNews**：免费层 100 次/天，`gnews.io` 国内可访问但无保证，返回 `articles[].{title, description, url, source}`。
- **结论**：新闻不单独接 API。**直接用博查/腾讯搜索按关键词搜新闻**（`freshness` 参数限定近 1 天/近 1 周），效果比接新闻源更好且统一；需要固定媒体时可加 RSS（BBC 中文、联合早报等，注意部分站点国内不可达）。

---

## 3. 推荐结论

### 主推组合（国内直连、免费额度够个人用、接入最简单）

> **搜索：博查 BochaAPI**（国内直连 ✅、注册即送免费额度 ✅、Bearer Token 一行接入 ✅、返回自带 AI summary 直接可注入 LLM ✅）
> **天气：Open-Meteo**（免费无 key ✅、地理编码+预报一体 ✅，国内可直连 🟡，加缓存/重试即可）
> **兜底：LLM 内置知识**（搜索失败/配额耗尽时降级为"根据截至训练时间的内置知识回答 + 明确告知用户")

### 备选排序

1. **腾讯云 WebSearchMCP**（国内直连，免费试用，需实名认证，接入略复杂）
2. **cn.bing.com 页面抓取**（零成本、国内直连，但非官方、HTML 结构易变，只做最终兜底并遵守 robots）
3. **Brave Search API**（海外/代理环境下质量好，免费 2000 次/月）
4. **Serper.dev**（一次性 2500 次，适合原型验证）
5. **SearXNG 自建**（有海外 VPS 时的自托管方案）
6. 排除项：Bing 官方 API（已停服）、DuckDuckGo（被墙）、SerpAPI（额度太小且贵）、NewsAPI（生产不可用）、公共 SearXNG 实例（不稳定）

### Key 获取成本与风险汇总

| 方案 | 成本 | 主要风险 |
|---|---|---|
| 博查 | 邮箱注册即得 | 免费额度到期；聚合结果个别字段缺失 |
| 腾讯云 WebSearchMCP | 腾讯云实名认证 | 签名接入复杂度；试用额度有限 |
| Open-Meteo | 零（无 key） | 国内直连波动；非商业条款 |
| Brave / Serper / SerpAPI | 邮箱注册 | 国内直连不保证；免费层禁生产 |
| 百度/阿里官方 | 企业资质/按量付费 | 个人项目成本与门槛高 |

---

## 4. 接入要点（curl + Node 18 fetch + 返回结构 + 错误码）

### 4.1 博查 BochaAPI（主推）

```bash
curl -X POST 'https://api.bochaai.com/v1/web-search' \
  -H 'Authorization: Bearer sk-你的key' \
  -H 'Content-Type: application/json' \
  -d '{"query":"今天北京天气","summary":true,"count":5}'
```

```js
// Node 18+ fetch
const res = await fetch('https://api.bochaai.com/v1/web-search', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.BOCHA_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: '最新科技新闻', summary: true, count: 5 }),
});
if (res.status === 429) { /* 配额/限流：退避重试或降级 */ }
const data = await res.json();
// 提取：data.data.webPages[].{ name, url, snippet, summary }（summary 由 API 生成，可直接拼进 LLM 上下文）
const pages = data?.data?.webPages ?? [];
const context = pages.map(p => `[${p.name}](${p.url}) ${p.summary || p.snippet}`).join('\n');
```

### 4.2 Open-Meteo（天气，无 key）

```bash
# 1) 地理编码：城市名 -> 经纬度
curl 'https://geocoding-api.open-meteo.com/v1/search?name=%E5%8C%97%E4%BA%AC&count=5&language=zh&format=json'
# 2) 天气预报
curl 'https://api.open-meteo.com/v1/forecast?latitude=39.90&longitude=116.40&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Asia%2FShanghai'
```

```js
const geo = await (await fetch(
  'https://geocoding-api.open-meteo.com/v1/search?name=' +
  encodeURIComponent('北京') + '&count=1&language=zh'
)).json();
const { latitude, longitude } = geo.results[0];
const wx = await (await fetch(
  `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
  '&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai'
)).json();
// wx.current.temperature_2m / wx.current.weather_code（WMO 码，0=晴，1-3=少云/多云，45=雾，61=雨，71=雪...）
```

### 4.3 Brave Search API（海外备选）

```bash
curl 'https://api.search.brave.com/res/v1/web/search?q=%E5%A4%A9%E6%B0%94&count=5' \
  -H 'X-Subscription-Token: 你的key' \
  -H 'Accept: application/json'
```

```js
// 提取：data.web.results[].{ title, url, description }
const items = (await res.json())?.web?.results ?? [];
```

### 4.4 Serper.dev（一次性试用）

```bash
curl -X POST 'https://google.serper.dev/search' \
  -H 'X-API-KEY: 你的key' -H 'Content-Type: application/json' \
  -d '{"q":"最新新闻"}'
```

```js
// 提取：data.organic[].{ title, link, snippet }
const items = (await res.json())?.organic ?? [];
```

### 4.5 其它（记录备查）

```bash
# SerpAPI（GET）
curl 'https://serpapi.com/search.json?q=test&api_key=KEY'   # organic_results[].{title,link,snippet}

# DuckDuckGo Instant Answer（仅瞬时答案；国内不可直连）
curl 'https://api.duckduckgo.com/?q=python&format=json&no_html=1&skip_disambig=1'  # AbstractText/Answer

# SearXNG 实例 JSON（多数公共实例禁用）
curl 'https://<instance>/search?q=test&format=json'          # results[].{title,url,content}
```

### 4.6 通用错误码与降级策略

| 状态码 | 含义 | 处理 |
|---|---|---|
| 401 / 403 | Key 无效 / 地区限制 | 检查 key；403 多为地区不可用（换国内方案） |
| **429** | 配额耗尽或限流 | **指数退避重试（如 1s/2s/4s），仍失败则降级**：换备用搜索源 → 用 LLM 内置知识回答并在回复中注明 |
| 5xx | 服务端错误 | 短退避重试；连续失败降级 |

统一封装建议：所有外部请求加 `AbortSignal.timeout(8000)`；搜索结果**缓存**（同一查询 10–30 分钟内不重复请求，省配额）；失败时返回结构化错误供上层 LLM 兜底。

---

## 5. 落地建议（最务实组合）

如果最终确认"国外 API 国内全部不可直连"（这是保守假设），推荐：

```
┌─ 天气 ──── Open-Meteo（免费无 key，可直连🟡）
│            └─ 失败/超时 → 和风天气 QWeather（国内免费版，需注册 key）
├─ 搜索 ──── 博查 BochaAPI（主，免费额度 + 按量便宜，国内直连✅）
│            └─ 429/失败 → 腾讯云 WebSearchMCP（国内直连，免费试用）
│            └─ 再失败 → cn.bing.com 页面抓取（零成本最终兜底，遵守 robots、限频）
├─ 新闻 ──── 不单独接 API：博查 `freshness=1d` 按关键词搜 + 必要时 RSS 白名单
└─ 兜底 ──── LLM 内置知识回答 + 明确告知"以下为模型内置知识，未联网"
```

工程要点：
1. **抽象统一 SearchProvider 接口**（`search(query, opts) -> {title,url,snippet}[]`），多源可插拔，故障自动降级，避免绑定单一厂商。
2. 天气与搜索**分离**：天气查询（"今天天气"）走天气专用 API（结构化、便宜、快），不要浪费搜索配额；通用问题才走网页搜索。
3. 配额预算：个人桌面应用每天几十次搜索足够，博查免费额度 + Open-Meteo 免费额度完全覆盖，**总成本约 0 元**。
4. 隐私与合规：搜索结果仅作上下文注入，不落盘留存；博查/腾讯云是国内服务，注意用户查询内容脱敏与隐私提示。

---

## 6. 主要参考资料

- 微软：Bing Search API 停用公告 — https://learn.microsoft.com/zh-cn/lifecycle/announcements/bing-search-api-retirement
- 微软 Q&A：Bing Search API 免费层 — https://learn.microsoft.com/en-ie/answers/questions/5538194/is-there-any-free-plan-for-bing-search-api
- firecrawl：Bing Search API 替代方案（停服后） — https://www.firecrawl.dev/blog/bing-search-api-alternatives
- 掘金：博查 Web Search API 平替 Bing、国内稳定使用 — https://juejin.cn/post/7425420976487809062
- 博查：免费领取调用资源包 — https://bocha-ai.feishu.cn/wiki/RWdvw557Li3IJekGeLkcDFa3n1f
- 腾讯：WebSearchMCP — https://github.com/Tencent/WebSearchMCP
- Brave：Search API 官方说明 — https://brave.com/zh/search/api/guides/what-sets-brave-search-api-apart/
- SerpAPI 定价 — https://serpapi.com/pricing
- SearXNG Search API 文档 — https://docs.searxng.org/dev/search_api
- Open-Meteo 文档 — https://open-meteo.com/en/docs
- Thunderbit：新闻 API 对比（NewsAPI 免费层限制） — https://thunderbit.com/zh-Hans/blog/best-news-apis-compared
- Search API 免费层对比（2026） — https://scavio.dev/glossary/search-api-free-tier
- Agent 搜索 API 成本对比（2026） — https://ecorpit.com/agent-web-search-api-cost-comparison-2026/
