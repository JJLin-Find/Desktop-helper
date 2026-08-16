/**
 * 实时信息检索工具（联网查询）
 *
 * - 天气：Open-Meteo（完全免费、无 key、全球、国内可直连）
 * - 网页搜索：provider 由配置决定（Bing/Brave/博查等，实现由调研确认后填充）
 * - 意图检测：查询含"天气"→ 天气；否则 → 网页搜索（如已配置）
 */
import type { JsonStore } from './store.service';
import { safeStorage } from 'electron';

/** 搜索 Key：明文存储（safeStorage 未签名开发模式重启不可靠；正式打包可恢复加密）。
 * 兼容旧数据：enc:(密文) / b64:(降级明文)。 */
const ENC_PREFIX = 'enc:';
const B64_PREFIX = 'b64:';

function decryptKey(stored: string): string {
  if (!stored) return '';
  if (stored.startsWith(B64_PREFIX)) {
    return Buffer.from(stored.slice(B64_PREFIX.length), 'base64').toString('utf8');
  }
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
    } catch {
      return '';
    }
  }
  return stored; // 明文（当前格式）/ 旧明文
}

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

export interface SearchConfig {
  /** 搜索 provider：'' 未配置 | 'bing' | 'brave' | 'bocha' 等 */
  provider: string;
  apiKey: string;
  enabled: boolean;
}

interface SearchStoreShape {
  search: SearchConfig;
}

/** 搜索端点（环境变量可覆盖，便于测试） */
const BOCHA_BASE = process.env['PET_BOCHA_BASE'] ?? 'https://api.bochaai.com';

/** 带超时的 fetch（避免网络挂起导致对话卡死） */
function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 6000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

const WEATHER_CODES: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '毛毛雨',
  53: '小毛毛雨',
  55: '毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  80: '阵雨',
  81: '强阵雨',
  82: '大阵雨',
  95: '雷暴',
  96: '雷暴伴冰雹',
  99: '强雷暴'
};

/** 从查询中提取城市名（去除"天气/怎么样/今天/现在"等词） */
function extractCity(query: string): string {
  let city = query
    .replace(/天气/g, '')
    .replace(/怎么样|如何|怎样/g, '')
    .replace(/今天|现在|明天|后天|昨天|实时|最新/g, '')
    .replace(/[的了吧呢吗？?！!，,。]/g, '')
    .trim();
  if (!city) city = '北京'; // 默认
  // 中文城市名可能包含"市"，保留原样交给地理编码
  return city;
}

/** 查询实时天气（Open-Meteo 免费无 key） */
export async function queryWeather(query: string): Promise<string> {
  try {
    const city = extractCity(query);
    // 1. 地理编码（5s 超时）
    const geoResp = await fetchWithTimeout(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`,
      {},
      5000
    );
    if (!geoResp.ok) return `天气查询失败（地理编码 HTTP ${geoResp.status}）`;
    const geo = (await geoResp.json()) as { results?: { latitude: number; longitude: number; name: string }[] };
    const loc = geo.results?.[0];
    if (!loc) return `未找到城市「${city}」的位置信息`;

    // 2. 实时天气（6s 超时）
    const wResp = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`,
      {},
      6000
    );
    if (!wResp.ok) return `天气查询失败（HTTP ${wResp.status}）`;
    const data = (await wResp.json()) as {
      current: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number };
    };
    const c = data.current;
    const desc = WEATHER_CODES[c.weather_code] ?? `代码${c.weather_code}`;
    return `${loc.name}：${desc}，${c.temperature_2m}°C，湿度 ${c.relative_humidity_2m}%，风速 ${c.wind_speed_10m} km/h（数据来源 Open-Meteo，查询时间 ${new Date().toLocaleString('zh-CN')}）`;
  } catch (err) {
    return `天气查询出错：${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 网页搜索（provider 实现；未配置返回空） */
export async function webSearch(query: string, config: SearchConfig): Promise<WebSearchResult[]> {
  if (!config.enabled || !config.provider || !config.apiKey) return [];
  switch (config.provider) {
    case 'bocha': {
      // 博查 BochaAPI（国内直连，推荐；注册送免费额度）——8s 超时
      const resp = await fetchWithTimeout(
        `${BOCHA_BASE}/v1/web-search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ query, count: 6, freshness: 'noLimit' })
        },
        8000
      );
      if (!resp.ok) throw new Error(`搜索失败（HTTP ${resp.status}）`);
      const data = (await resp.json()) as {
        data?: { webPages?: { value?: { name?: string; snippet?: string; summary?: string; url?: string }[] } };
      };
      return (data.data?.webPages?.value ?? []).map((p) => ({
        title: p.name ?? '',
        snippet: p.summary ?? p.snippet ?? '',
        url: p.url ?? ''
      }));
    }
    default:
      return []; // 其他 provider 已不可用（如 Bing API 2025-08 停服）
  }
}

/** 意图检测：是否需要天气查询 */
export function isWeatherQuery(query: string): boolean {
  return /天气|气温|多少度|下雨|下雪|冷吗|热吗/.test(query);
}

/** 检索服务：按意图组装实时上下文（供注入 LLM） */
export class RealtimeRetrieval {
  constructor(private readonly store: JsonStore<SearchStoreShape>) {}

  getSearchConfig(): SearchConfig {
    const saved = this.store.get('search');
    return {
      provider: saved?.provider ?? '',
      apiKey: decryptKey(saved?.apiKey ?? ''),
      enabled: saved?.enabled ?? true
    };
  }

  setSearchConfig(patch: Partial<SearchConfig>): void {
    const cur = this.getSearchConfig();
    const next: SearchConfig = { ...cur, ...patch };
    // Key 明文存储（空/'***' 保持不变）
    if (patch.apiKey !== undefined) {
      if (patch.apiKey && patch.apiKey !== '***') {
        next.apiKey = patch.apiKey; // 明文
      } else if (!patch.apiKey) {
        next.apiKey = '';
      } else {
        next.apiKey = cur.apiKey; // '***' 表示未修改
      }
    }
    this.store.set('search', {
      provider: next.provider,
      apiKey: next.apiKey,
      enabled: next.enabled
    });
  }

  /** 是否配置了搜索（或仅天气可用） */
  hasSearch(): boolean {
    const c = this.getSearchConfig();
    return c.enabled && Boolean(c.provider && c.apiKey);
  }

  /** 为查询检索实时上下文（整体 8s 超时兜底，超时返回空，不阻塞对话） */
  async retrieve(query: string): Promise<string> {
    const result = await Promise.race([
      this.doRetrieve(query),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 8000))
    ]);
    return result;
  }

  private async doRetrieve(query: string): Promise<string> {
    const parts: string[] = [];
    if (isWeatherQuery(query)) {
      const w = await queryWeather(query);
      if (w && !w.startsWith('天气查询')) parts.push(`【天气信息】${w}`);
    }
    const searchable = query.length > 4 || !isWeatherQuery(query);
    if (searchable && this.hasSearch()) {
      try {
        const results = await webSearch(query, this.getSearchConfig());
        if (results.length > 0) {
          parts.push(
            '【网页搜索结果】\n' +
              results
                .map((r, i) => `${i + 1}. ${r.title}：${r.snippet}（${r.url}）`)
                .join('\n')
          );
        }
      } catch (err) {
        parts.push(`【网页搜索失败】${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return parts.join('\n\n');
  }
}
