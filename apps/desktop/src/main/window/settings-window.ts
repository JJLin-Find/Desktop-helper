/**
 * AI 设置窗口（普通窗口，配置 provider / API Key / 模型）
 * 复用桌宠 preload（window.pet.aiProviders/aiConfigGet/aiConfigSet）。
 */
import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const SETTINGS_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<style>
  body { font-family: -apple-system, 'PingFang SC', sans-serif; margin: 20px; color: #333; background: #fafafa; }
  h2 { margin-top: 0; font-size: 16px; }
  label { display: block; margin: 12px 0 4px; font-size: 12px; color: #666; }
  select, input { width: 100%; padding: 7px 9px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; box-sizing: border-box; }
  .hint { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.5; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
  button { padding: 8px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  #save { background: #e8a04c; color: #fff; }
  #status { margin-left: 10px; font-size: 12px; color: #2a9d3a; }
  #status.error { color: #d33; }
</style>
</head>
<body>
<h2>🤖 AI 对话设置</h2>
<label>桌宠名称（聊天框标题 = "名称自习室"）</label>
<input id="petName" placeholder="如：皮丘" />
<label>AI 服务商</label>
<select id="provider"></select>
<div class="hint" id="hint"></div>
<label>API Key（本地模型无需填写）</label>
<input id="apiKey" type="password" placeholder="粘贴你的 API Key" />
<label>模型名（留空使用默认）</label>
<input id="model" placeholder="例如 glm-4-flash-250414" />
<label>自定义 baseURL（可选，接代理/中转时填写）</label>
<input id="baseURL" placeholder="留空使用默认；如 https://your-proxy.example/v1" />
<hr style="margin:18px 0;border:none;border-top:1px solid #eee" />
<h2 style="margin-top:0;font-size:15px">🔎 联网搜索（实时信息查询）</h2>
<label style="display:flex;align-items:center;gap:6px">
  <input type="checkbox" id="searchEnabled" style="width:auto" /> 启用网页搜索（查询时实时检索）
</label>
<label>搜索服务商</label>
<select id="searchProvider">
  <option value="">未配置（仅天气查询可用）</option>
  <option value="bocha">博查 BochaAPI（国内直连，推荐）</option>
</select>
<div class="hint" id="searchHint">天气查询（Open-Meteo）无需配置；网页搜索用博查 API Key（bochaai.com 注册送免费额度）。</div>
<label>搜索 API Key</label>
<input id="searchKey" type="password" placeholder="搜索服务商 API Key" />
<div class="row">
  <button id="save">保存</button>
  <span id="status"></span>
</div>
<script>
  const $ = (id) => document.getElementById(id);
  let presets = [];

  async function load() {
    $('petName').value = await window.pet.petNameGet();
    presets = await window.pet.aiProviders();
    const cfg = await window.pet.aiConfigGet();
    const sel = $('provider');
    for (const p of presets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    }
    sel.value = cfg.providerId || presets[0]?.id;
    $('apiKey').value = cfg.apiKey === '***' ? '' : (cfg.apiKey || '');
    $('model').value = cfg.model || '';
    $('baseURL').value = cfg.baseURL || '';
    onProviderChange();
    sel.addEventListener('change', onProviderChange);

    // 搜索配置
    const sc = await window.pet.searchConfigGet();
    $('searchEnabled').checked = sc ? sc.enabled : true;
    $('searchProvider').value = sc?.provider || '';
    $('searchKey').value = sc && sc.apiKey === '***' ? '' : (sc?.apiKey || '');
  }

  function onProviderChange() {
    const p = presets.find((x) => x.id === $('provider').value);
    $('hint').textContent = p ? p.keyHint || '' : '';
    const needsKey = p ? p.requiresKey : true;
    $('apiKey').style.display = needsKey ? 'block' : 'none';
    if ($('provider').value === 'custom') {
      // 自定义（局域网自部署）：网关地址 + 模型名必填，Key 可选
      $('baseURL').placeholder = '填写网关地址，如 http://192.168.1.10:8000/v1';
      $('model').placeholder = '填写模型名，如 qwen2.5-72b';
      $('baseURL').style.borderColor = '#e8a04c';
      $('model').style.borderColor = '#e8a04c';
    } else {
      $('baseURL').placeholder = '留空使用默认；如 https://your-proxy.example/v1';
      $('baseURL').style.borderColor = '';
      $('model').style.borderColor = '';
      if (!needsKey) $('model').placeholder = '留空使用本地默认模型';
      else if (p && !$('model').value) $('model').placeholder = p.model;
    }
  }

  $('save').addEventListener('click', async () => {
    const status = $('status');
    try {
      await window.pet.petNameSet($('petName').value);
      await window.pet.aiConfigSet({
        providerId: $('provider').value,
        apiKey: $('apiKey').value,
        model: $('model').value || undefined,
        baseURL: $('baseURL').value || undefined
      });
      await window.pet.searchConfigSet({
        provider: $('searchProvider').value,
        apiKey: $('searchKey').value,
        enabled: $('searchEnabled').checked
      });
      status.textContent = '✅ 已保存';
      status.className = '';
      // 保存成功后自动关闭设置窗口
      setTimeout(() => window.close(), 500);
    } catch (e) {
      status.textContent = '❌ ' + e.message;
      status.className = 'error';
    }
  });

  load();
</script>
</body>
</html>`;

export function openAISettingsWindow(): void {
  const win = new BrowserWindow({
    width: 420,
    height: 520,
    title: 'AI 对话设置',
    resizable: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SETTINGS_HTML)}`);
  win.on('closed', () => {
    // 窗口关闭即销毁
  });
}
