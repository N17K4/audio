/**
 * LlmProviderConfig — 可复用的 LLM 提供商配置块
 *
 * RAG 和 Agent 页面共享，字段完全一致。
 * 支持：Ollama 本地 + 国际云端（OpenAI / Gemini / Groq / DeepSeek / Mistral）
 *      + 中国云端（通义千问 / 豆包 / 混元 / GLM / Kimi / 星火 / MiniMax）
 */

// ─── 服务商定义 ────────────────────────────────────────────────────────────

interface ProviderDef {
  label: string;
  models: string[];
  defaultModel: string;
  needsKey: boolean;    // 是否需要 API Key
  needsUrl: boolean;    // 是否需要自定义 URL（仅 Ollama）
  keyPlaceholder?: string;
  keyHint?: string;
}

const PROVIDERS: Record<string, ProviderDef> = {
  // ── 本地 ──────────────────────────────────────────────────────────────────
  ollama: {
    label: 'Ollama（本地）',
    models: ['qwen2.5:0.5b', 'qwen2.5:7b', 'qwen2.5:14b', 'qwen3:8b', 'qwen3:14b',
             'llama3.2:3b', 'llama3.3:70b', 'deepseek-r1:7b', 'mistral:7b', 'gemma3:9b'],
    defaultModel: 'qwen2.5:0.5b',  // 与 smoke_test2 保持一致
    needsKey: false,
    needsUrl: true,
  },
  // ── 国际云端 ──────────────────────────────────────────────────────────────
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini', 'o3-mini'],
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'sk-...',
    keyHint: '在 platform.openai.com 获取',
  },
  gemini: {
    label: 'Gemini · Google（有免费额度）',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    defaultModel: 'gemini-2.5-flash',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'AIza...',
    keyHint: '在 aistudio.google.com 免费获取',
  },
  groq: {
    label: 'Groq（有免费额度）',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    defaultModel: 'llama-3.3-70b-versatile',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'gsk_...',
    keyHint: '在 console.groq.com 免费获取（速度极快）',
  },
  deepseek: {
    label: 'DeepSeek（推理 / 代码强）',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'sk-...',
    keyHint: '在 platform.deepseek.com 获取',
  },
  mistral: {
    label: 'Mistral AI',
    models: ['mistral-small-latest', 'mistral-large-latest', 'codestral-latest'],
    defaultModel: 'mistral-small-latest',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: '...',
    keyHint: '在 console.mistral.ai 获取',
  },
  // ── 中国云端 ──────────────────────────────────────────────────────────────
  qwen: {
    label: '通义千问 · 阿里云',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long', 'qwen2.5-72b-instruct'],
    defaultModel: 'qwen-plus',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'sk-...',
    keyHint: '在 dashscope.aliyuncs.com 获取',
  },
  glm: {
    label: 'GLM · 智谱（4-Flash 永久免费）',
    models: ['glm-4-flash', 'glm-4-flashx', 'glm-4-air', 'glm-4-plus', 'glm-z1-flash'],
    defaultModel: 'glm-4-flash',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: '...',
    keyHint: '在 open.bigmodel.cn 获取，glm-4-flash 永久免费',
  },
  moonshot: {
    label: 'Kimi · 月之暗面',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-8k',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: 'sk-...',
    keyHint: '在 platform.moonshot.cn 获取',
  },
  doubao: {
    label: '豆包 · 字节跳动',
    models: [],  // 豆包用 endpoint ID，格式 ep-xxx，需手填
    defaultModel: '',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: '...',
    keyHint: '在 console.volcengine.com 获取，模型名填 ep-xxx 格式',
  },
  hunyuan: {
    label: '混元 · 腾讯（Lite 永久免费）',
    models: ['hunyuan-lite', 'hunyuan-standard', 'hunyuan-pro', 'hunyuan-turbo'],
    defaultModel: 'hunyuan-lite',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: '...',
    keyHint: '在 console.cloud.tencent.com 获取，hunyuan-lite 永久免费',
  },
  minimax: {
    label: 'MiniMax',
    models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab5.5-chat'],
    defaultModel: 'MiniMax-Text-01',
    needsKey: true,
    needsUrl: false,
    keyPlaceholder: '...',
    keyHint: '在 platform.minimaxi.com 获取',
  },
};

// 分组显示用
const PROVIDER_GROUPS: { label: string; keys: string[] }[] = [
  { label: '本地', keys: ['ollama'] },
  { label: '国际云端', keys: ['openai', 'gemini', 'groq', 'deepseek', 'mistral'] },
  { label: '中国云端', keys: ['qwen', 'glm', 'moonshot', 'doubao', 'hunyuan', 'minimax'] },
];

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface LlmConfig {
  provider: string;
  ollamaUrl: string;  // 仅 Ollama 使用
  model: string;
  customModel: string; // 覆盖下拉选中的模型名（手动输入）
  apiKey: string;
}

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: 'ollama',
  ollamaUrl: 'http://127.0.0.1:11434',
  model: 'qwen2.5:0.5b',  // 与 smoke_test2 保持一致
  customModel: '',
  apiKey: '',
};

// 实际生效的模型名：优先用手动输入，其次用下拉选择
export function resolveModel(cfg: LlmConfig): string {
  return cfg.customModel.trim() || cfg.model;
}

interface Props {
  config: LlmConfig;
  onChange: (c: LlmConfig) => void;
  title?: string;
}

// ─── 通用样式 ──────────────────────────────────────────────────────────────
const INPUT: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd',
  fontSize: 13, width: '100%', boxSizing: 'border-box',
};
const SELECT: React.CSSProperties = {
  ...INPUT, background: '#fff', cursor: 'pointer',
};
const LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#555',
  display: 'block', marginBottom: 4,
};
const HINT: React.CSSProperties = {
  fontSize: 11, color: '#999', marginTop: 4,
};

// ─── 组件 ──────────────────────────────────────────────────────────────────

export default function LlmProviderConfig({
  config,
  onChange,
  title = '语言模型',
}: Props) {
  const set = (patch: Partial<LlmConfig>) => onChange({ ...config, ...patch });

  const def = PROVIDERS[config.provider] ?? PROVIDERS['ollama'];

  // 切换服务商时重置模型为该服务商的默认值
  const handleProviderChange = (p: string) => {
    const d = PROVIDERS[p] ?? PROVIDERS['ollama'];
    onChange({
      ...config,
      provider: p,
      model: d.defaultModel,
      customModel: '',
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, color: '#333', marginBottom: 2 }}>
          {title}
        </div>
      )}

      {/* ── 服务商：分组下拉列表 ── */}
      <div>
        <label style={LABEL}>服务商</label>
        <select
          style={SELECT}
          value={config.provider}
          onChange={e => handleProviderChange(e.target.value)}
        >
          {PROVIDER_GROUPS.map(group => (
            <optgroup key={group.label} label={`── ${group.label} ──`}>
              {group.keys.map(k => (
                <option key={k} value={k}>
                  {PROVIDERS[k]?.label ?? k}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {/* ── Ollama 专属：服务地址 ── */}
      {def.needsUrl && (
        <div>
          <label style={LABEL}>
            服务地址
            <span style={{ fontWeight: 400, color: '#999', marginLeft: 6 }}>
              （默认 http://127.0.0.1:11434）
            </span>
          </label>
          <input
            style={INPUT}
            value={config.ollamaUrl}
            onChange={e => set({ ollamaUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434"
          />
          <div style={HINT}>
            需先在终端运行 <code>ollama serve</code>，
            并执行 <code>ollama pull {resolveModel(config)}</code>
          </div>
        </div>
      )}

      {/* ── 云端服务商：API Key ── */}
      {def.needsKey && (
        <div>
          <label style={LABEL}>API Key</label>
          <input
            type="password"
            style={INPUT}
            value={config.apiKey}
            onChange={e => set({ apiKey: e.target.value })}
            placeholder={def.keyPlaceholder ?? ''}
          />
          {def.keyHint && <div style={HINT}>{def.keyHint}</div>}
        </div>
      )}

      {/* ── 模型：预设下拉 + 自定义输入 ── */}
      <div>
        <label style={LABEL}>模型</label>

        {/* 下拉预设（有预设模型时显示）*/}
        {def.models.length > 0 && (
          <select
            style={{ ...SELECT, marginBottom: 6 }}
            value={config.model}
            onChange={e => set({ model: e.target.value, customModel: '' })}
          >
            {def.models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        {/* 自定义模型名：填写后覆盖上方下拉 */}
        <input
          style={{ ...INPUT, color: config.customModel ? '#222' : '#aaa' }}
          value={config.customModel}
          onChange={e => set({ customModel: e.target.value })}
          placeholder={
            def.models.length > 0
              ? '或手动输入模型名（填写后覆盖上方选择）'
              : '输入模型名（如 ep-xxxxxxxx，豆包用 endpoint ID）'
          }
        />

        {/* 最终生效的模型名提示 */}
        <div style={HINT}>
          当前生效：<code style={{ color: '#4f46e5' }}>{resolveModel(config) || '（未填写）'}</code>
        </div>
      </div>
    </div>
  );
}
