import { useEffect, useState } from 'react';
import { DEFAULT_MODELS, clearByok, loadByok, saveByok, type ByokProvider } from '../../ai/byok';
import { useAiUi } from './AiContext';
import { Sheet } from './Sheet';

interface UsageInfo {
  provider: string;
  model: string | null;
  today: { dateUtc: string; total: { requests: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number } };
}

export function SettingsDialog() {
  const { state, close } = useAiUi();
  const current = loadByok();
  const [provider, setProvider] = useState<ByokProvider>(current?.provider ?? 'openai');
  const [apiKey, setApiKey] = useState(current?.apiKey ?? '');
  const [model, setModel] = useState(current?.model ?? '');
  const [saved, setSaved] = useState(false);
  const [usage, setUsage] = useState<UsageInfo | 'error' | null>(null);

  useEffect(() => {
    if (!state.settingsOpen) return;
    const s = loadByok();
    setProvider(s?.provider ?? 'openai');
    setApiKey(s?.apiKey ?? '');
    setModel(s?.model ?? '');
    setSaved(false);
    setUsage(null);
  }, [state.settingsOpen]);

  if (!state.settingsOpen) return null;

  const loadUsage = async () => {
    try {
      const res = await fetch('/api/usage');
      setUsage(res.ok ? ((await res.json()) as UsageInfo) : 'error');
    } catch {
      setUsage('error');
    }
  };

  return (
    <Sheet title="⚙️ Cài đặt AI" onClose={() => close('settings')}>
      <div className="sheet-body settings">
        <p>
          Đang dùng: <strong>{current ? `API key riêng (${current.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · ${current.model})` : 'Máy chủ của Vocab Battle'}</strong>
        </p>

        <section className="card">
          <h3>🔑 Dùng API key riêng (dự phòng)</h3>
          <p className="warn-box">
            ⚠️ Key được lưu trong trình duyệt này và gửi thẳng tới nhà cung cấp AI. Chỉ dùng trên máy cá nhân, đừng nhập key trên máy dùng chung. Chi phí sẽ
            tính vào tài khoản của bạn.
          </p>
          <div className="chips" role="radiogroup" aria-label="Nhà cung cấp">
            {(['openai', 'anthropic'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={provider === p} className={`chip ${provider === p ? 'on' : ''}`} onClick={() => setProvider(p)}>
                {p === 'openai' ? 'OpenAI' : 'Anthropic (Claude)'}
              </button>
            ))}
          </div>
          <label>
            API key
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label>
            Model
            <input className="input" value={model} placeholder={DEFAULT_MODELS[provider]} onChange={(e) => setModel(e.target.value)} />
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!apiKey.trim()}
              onClick={() => {
                saveByok({ provider, apiKey: apiKey.trim(), model: model.trim() || DEFAULT_MODELS[provider] });
                setSaved(true);
              }}
            >
              Lưu
            </button>
            <button
              type="button"
              className="btn"
              disabled={!current}
              onClick={() => {
                clearByok();
                setApiKey('');
                setModel('');
                setSaved(false);
              }}
            >
              Xoá key, dùng máy chủ
            </button>
          </div>
          {saved && <p className="muted">✓ Đã lưu. Từ giờ tra từ và chat sẽ dùng key của bạn.</p>}
        </section>

        <section className="card">
          <h3>📊 Mức dùng AI hôm nay (máy chủ)</h3>
          <button type="button" className="btn small" onClick={loadUsage}>
            Xem thống kê
          </button>
          {usage === 'error' && <p className="muted">Không lấy được thống kê.</p>}
          {usage && usage !== 'error' && (
            <p className="muted small">
              {usage.today.dateUtc} (UTC) · {usage.provider}/{usage.model ?? '?'} · {usage.today.total.requests} yêu cầu · {usage.today.total.inputTokens} token vào /{' '}
              {usage.today.total.outputTokens} token ra · ước tính ${usage.today.total.estimatedCostUsd.toFixed(4)}
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
