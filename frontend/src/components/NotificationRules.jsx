/**
 * Bildirim kuralları — web karşılıkları.
 *
 * Mobilde bu ekranlar vardı, webde hiç yoktu: kullanıcı kural kurmak için
 * telefona geçmek zorunda kalıyordu. Uçlar ve alan adları mobil ile birebir
 * aynı (mobile/src/screens/SettingsScreen.js, HomeScreen.js, RssReaderScreen.js).
 *
 * Not: bildirimin kendisi telefona gider (Expo push); web yalnızca kuralları
 * yönetir.
 */
import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../Utils/api';

const API = () => import.meta.env.VITE_API_URL;

// Sunucudaki sınırlarla aynı (routers/notifications.py, rss_reader.py).
export const INTERVAL_MIN = 15;
export const INTERVAL_MAX = 1440;
export const INTERVAL_STEP = 15;

/** 90 → "1 sa 30 dk", 60 → "1 sa", 45 → "45 dk" (mobil formatInterval ile aynı) */
export function formatInterval(m) {
  const total = Number(m) || INTERVAL_MIN;
  const h = Math.floor(total / 60);
  const mm = total % 60;
  if (h === 0) return `${mm} dk`;
  return mm === 0 ? `${h} sa` : `${h} sa ${mm} dk`;
}

const ui = {
  chip: (on) => ({
    padding: '8px 14px', borderRadius: '12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
    border: `1px solid ${on ? '#818cf8' : 'rgba(255,255,255,0.1)'}`,
    background: on ? 'rgba(99,102,241,0.18)' : 'transparent',
    color: on ? '#c7d2fe' : '#64748b',
  }),
  label: { display: 'block', color: '#cbd5e1', fontSize: '0.78rem', fontWeight: 700, margin: '16px 0 8px' },
  row: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  btn: (kind = 'primary') => ({
    padding: '11px 18px', borderRadius: '12px', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
    border: kind === 'primary' ? 'none' : '1px solid rgba(99,102,241,0.4)',
    background: kind === 'primary' ? 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)' : 'transparent',
    color: kind === 'primary' ? 'white' : '#c7d2fe',
  }),
  input: {
    width: '100%', padding: '11px 14px', borderRadius: '12px', boxSizing: 'border-box',
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(2,6,23,0.5)', color: 'white', outline: 'none',
  },
  card: {
    background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '28px', padding: '2rem',
  },
  ruleRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', marginBottom: '8px',
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px',
  },
  hint: { color: '#475569', fontSize: '0.72rem', marginTop: '6px' },
};

/** Aç/kapa anahtarı — mobildeki Switch'in web karşılığı. */
export function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      style={{
        width: '46px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', flexShrink: 0,
        background: checked ? '#6366f1' : 'rgba(148,163,184,0.25)', position: 'relative', transition: 'background 0.2s',
      }}
    >
      <span style={{
        position: 'absolute', top: '3px', left: checked ? '23px' : '3px', width: '20px', height: '20px',
        borderRadius: '50%', background: 'white', transition: 'left 0.2s',
      }} />
    </button>
  );
}

/**
 * −/+ ile aralık seçici. Basılı tutunca hızlanır (95 adım tek tek basılmasın),
 * mobildeki IntervalStepper ile aynı davranış ve aynı sınırlar.
 */
export function IntervalStepper({ value, onChange, min = INTERVAL_MIN, max = INTERVAL_MAX, step = INTERVAL_STEP }) {
  const cur = Number(value) || min;
  const timerRef = useRef(null);
  const countRef = useRef(0);
  const valueRef = useRef(cur);

  useEffect(() => { valueRef.current = Number(value) || min; }, [value, min]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const stop = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    countRef.current = 0;
  };

  const apply = (delta) => {
    const now = valueRef.current;
    const next = Math.min(max, Math.max(min, now + delta));
    if (next === now) return false;
    valueRef.current = next;
    onChange(next);
    return true;
  };

  const start = (dir) => {
    apply(dir * step);
    countRef.current = 0;
    const tick = () => {
      countRef.current += 1;
      const n = countRef.current;
      const mult = n > 20 ? 4 : n > 8 ? 2 : 1;
      const delay = n > 20 ? 60 : n > 8 ? 80 : 110;
      if (!apply(dir * step * mult)) { stop(); return; }
      timerRef.current = setTimeout(tick, delay);
    };
    timerRef.current = setTimeout(tick, 400);
  };

  const btn = (disabled) => ({
    width: '46px', height: '46px', borderRadius: '12px', fontSize: '1.2rem', fontWeight: 800,
    border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.12)', color: '#c7d2fe',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.35 : 1,
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button type="button" disabled={cur <= min} style={btn(cur <= min)}
          onMouseDown={() => start(-1)} onMouseUp={stop} onMouseLeave={stop}>−</button>
        <div style={{
          flex: 1, maxWidth: '220px', height: '46px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(2,6,23,0.5)',
          color: 'white', fontWeight: 800,
        }}>{formatInterval(cur)}</div>
        <button type="button" disabled={cur >= max} style={btn(cur >= max)}
          onMouseDown={() => start(1)} onMouseUp={stop} onMouseLeave={stop}>+</button>
      </div>
      <div style={ui.hint}>
        {step} dakikalık adımlarla · basılı tutunca hızlanır · {formatInterval(min)} – {formatInterval(max)}
      </div>
    </div>
  );
}

/** "Hemen / Aralıklı" + "Tek özet / Her makale ayrı" — üç ekranda da ortak form. */
function ScheduleFields({ form, setForm, itemWord = 'makale' }) {
  return (
    <>
      <label style={ui.label}>Ne zaman?</label>
      <div style={ui.row}>
        {[{ k: 'immediate', l: 'Hemen (~15 dk)' }, { k: 'interval', l: 'Aralıklı' }].map(o => (
          <button key={o.k} type="button" style={ui.chip(form.mode === o.k)}
            onClick={() => setForm(p => ({ ...p, mode: o.k }))}>{o.l}</button>
        ))}
      </div>

      {form.mode === 'interval' && (
        <div style={{ marginTop: '12px' }}>
          <IntervalStepper
            value={form.interval_minutes || INTERVAL_MIN}
            onChange={(v) => setForm(p => ({ ...p, interval_minutes: v }))}
          />
        </div>
      )}

      <label style={ui.label}>Nasıl gelsin?</label>
      <div style={ui.row}>
        {[{ k: 'digest', l: 'Tek özet' }, { k: 'individual', l: `Her ${itemWord} ayrı` }].map(o => (
          <button key={o.k} type="button" style={ui.chip(form.grouping === o.k)}
            onClick={() => setForm(p => ({ ...p, grouping: o.k }))}>{o.l}</button>
        ))}
      </div>
    </>
  );
}

// ── Gündem bildirimi (Ayarlar kartı) ─────────────────────────────────────────

export function TrendingNotifications({ showToast }) {
  const [tab, setTab] = useState('news');            // 'news' | 'rss'
  const [trends, setTrends] = useState({ news: null, rss: null });
  const [saving, setSaving] = useState(false);
  const trend = trends[tab];

  useEffect(() => {
    (async () => {
      try {
        const [n, r] = await Promise.all([
          fetchWithAuth(`${API()}/notifications/trending/news`),
          fetchWithAuth(`${API()}/notifications/trending/rss`),
        ]);
        setTrends({ news: n.ok ? await n.json() : null, rss: r.ok ? await r.json() : null });
      } catch (_) { /* sessiz: bölüm yüklenmezse gizli kalır */ }
    })();
  }, []);

  const setTrend = (updater) => setTrends(prev => ({
    ...prev, [tab]: typeof updater === 'function' ? updater(prev[tab]) : updater,
  }));

  const save = async () => {
    if (!trend) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API()}/notifications/trending/${tab}`, {
        method: 'PUT',
        body: JSON.stringify({
          enabled: trend.enabled,
          mode: trend.mode,
          interval_minutes: trend.mode === 'interval' ? (trend.interval_minutes || INTERVAL_MIN) : null,
          grouping: trend.grouping,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '');
      const saved = await res.json();
      setTrends(p => ({ ...p, [tab]: saved }));
      showToast(tab === 'news' ? 'Akış gündemi kaydedildi.' : 'RSS gündemi kaydedildi.', 'success');
    } catch (e) { showToast(e?.message || 'Kaydedilemedi.', 'error'); }
    finally { setSaving(false); }
  };

  if (!trend) return null;

  return (
    <div style={{ ...ui.card, gridColumn: 'span 2' }}>
      <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.6rem' }}>🔥 Gündem Bildirimi</h3>

      {/* İki ayrı kural: akış gündemi ve RSS gündemi, her biri kendi ayarıyla */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {[{ k: 'news', l: '📰 Akış Gündemi' }, { k: 'rss', l: '📡 RSS Gündemi' }].map(t => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} style={ui.chip(tab === t.k)}>
            {t.l}{trends[t.k]?.enabled ? ' ●' : ''}
          </button>
        ))}
      </div>

      <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '0 0 14px', lineHeight: 1.5 }}>
        {tab === 'news'
          ? 'Haber akışındaki gündem (en çok ilgi gören kategorilerden en yeni haberler).'
          : 'Tüm RSS listelerindeki beslemelerden derlenen gündem.'}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '420px' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 700 }}>Bildirim gönder</span>
        <Toggle checked={!!trend.enabled} onChange={(v) => setTrend(p => ({ ...p, enabled: v }))} />
      </div>

      {trend.enabled && (
        <>
          <ScheduleFields form={trend} setForm={setTrend} itemWord="haber" />
          {trend.configured && !trend.ready && (
            <p style={{ color: '#fbbf24', fontSize: '0.75rem', marginTop: '10px' }}>
              ⏳ İlk tarama sürüyor — bittikten sonraki yeni haberler bildirilecek.
            </p>
          )}
        </>
      )}

      <p style={{ color: '#475569', fontSize: '0.72rem', marginTop: '14px', lineHeight: 1.5 }}>
        Sessiz saatlerde bildirim gönderilmez; biriken haberler aralık bitince tek özet olarak gelir.
        Bildirimler telefona gider.
      </p>

      <button type="button" onClick={save} disabled={saving} style={{ ...ui.btn('ghost'), marginTop: '16px' }}>
        {saving ? 'Kaydediliyor…' : tab === 'news' ? 'Akış Gündemini Kaydet' : 'RSS Gündemini Kaydet'}
      </button>
    </div>
  );
}

// ── Ortak modal kabuğu ───────────────────────────────────────────────────────

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.85)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '1rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'rgba(15,23,42,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '24px',
          padding: '1.75rem', width: '100%', maxWidth: '560px', maxHeight: '85vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800 }}>{title}</h3>
            {subtitle && <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: '0.8rem' }}>{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RuleActions({ onEdit, onDelete }) {
  return (
    <>
      <button type="button" onClick={onEdit}
        style={{ background: 'transparent', border: 'none', color: '#818cf8', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>Düzenle</button>
      <button type="button" onClick={onDelete}
        style={{ background: 'transparent', border: 'none', color: '#ef4444', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>Sil</button>
    </>
  );
}

// ── Akış (kategori) bildirim kuralları — Home ────────────────────────────────

const catSummary = (r) =>
  `${formatInterval(r.effective_interval_minutes)} · ${r.grouping === 'digest' ? 'tek özet' : 'her haber ayrı'}`;

export function CategoryRulesModal({ onClose, interests = [], showToast }) {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const res = await fetchWithAuth(`${API()}/notifications/category-rules`);
      if (res.ok) setRules(await res.json());
    } catch (_) { showToast('Bildirim kuralları yüklenemedi.', 'error'); }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    const payload = {
      mode: form.mode,
      interval_minutes: form.mode === 'interval' ? form.interval_minutes : null,
      grouping: form.grouping,
    };
    try {
      const res = form.id
        ? await fetchWithAuth(`${API()}/notifications/category-rules/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await fetchWithAuth(`${API()}/notifications/category-rules`, { method: 'POST', body: JSON.stringify({ ...payload, category_id: form.category_id }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '');
      showToast(form.id ? 'Kural güncellendi.' : 'Kural eklendi.', 'success');
      setForm(null);
      load();
    } catch (e) { showToast(e?.message || 'Kaydedilemedi.', 'error'); }
    finally { setSaving(false); }
  };

  const toggle = async (rule) => {
    // İyimser güncelleme — anahtar anında tepki versin.
    setRules(p => p.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    try {
      const res = await fetchWithAuth(`${API()}/notifications/category-rules/${rule.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error();
    } catch (_) {
      setRules(p => p.map(r => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      showToast('Değiştirilemedi.', 'error');
    }
  };

  const remove = async (id) => {
    try {
      const res = await fetchWithAuth(`${API()}/notifications/category-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRules(p => p.filter(r => r.id !== id));
      showToast('Kural silindi.', 'success');
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  const q = search.trim().toLowerCase();
  const addable = interests
    .filter(c => !rules.some(r => r.category_id === c.id))
    .filter(c => !q || (c.name || '').toLowerCase().includes(q));

  return (
    <ModalShell
      title="🔔 Akış Bildirimleri"
      subtitle="Kategori başına bildirim kuralı. Bildirimler telefona gider."
      onClose={onClose}
    >
      {!form ? (
        <>
          {rules.length === 0 ? (
            <p style={{ color: '#475569', textAlign: 'center', margin: '24px 0' }}>Henüz kural yok.</p>
          ) : rules.map(r => (
            <div key={r.id} style={ui.ruleRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 700 }}>{r.category_name || r.name}</div>
                <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: '2px' }}>{catSummary(r)}</div>
                {!r.ready && <div style={{ color: '#fbbf24', fontSize: '0.68rem', marginTop: '2px' }}>⏳ ilk tarama sürüyor…</div>}
              </div>
              <Toggle checked={!!r.enabled} onChange={() => toggle(r)} />
              <RuleActions
                onEdit={() => setForm({ id: r.id, category_id: r.category_id, mode: r.mode, interval_minutes: r.interval_minutes || 60, grouping: r.grouping })}
                onDelete={() => remove(r.id)}
              />
            </div>
          ))}

          <label style={ui.label}>Kategori seç ve kural ekle</label>
          <input style={ui.input} placeholder="Kategori ara (ör. bilim)" value={search}
            onChange={e => setSearch(e.target.value)} />
          <div style={{ ...ui.row, marginTop: '10px' }}>
            {addable.length === 0 ? (
              <span style={{ color: '#475569', fontSize: '0.8rem' }}>
                {q ? 'Eşleşen kategori yok.' : 'Tüm kategoriler için kural kurulmuş.'}
              </span>
            ) : addable.map(c => (
              <button key={c.id} type="button" style={ui.chip(false)}
                onClick={() => setForm({ id: null, category_id: c.id, mode: 'immediate', interval_minutes: 60, grouping: 'digest' })}>
                + {c.name}
              </button>
            ))}
          </div>
          <p style={ui.hint}>
            Kural yalnızca ilgi alanlarındaki kategoriler için kurulabilir (Ayarlar → Haber Tercihleri).
          </p>
        </>
      ) : (
        <>
          <ScheduleFields form={form} setForm={setForm} itemWord="haber" />
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button type="button" onClick={save} disabled={saving} style={ui.btn('primary')}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={() => setForm(null)} style={ui.btn('ghost')}>Vazgeç</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ── RSS listesi bildirim kuralları — RssReader ───────────────────────────────

const EMPTY_RSS_RULE = {
  id: null, name: '', scope: 'all', feed_ids: [],
  mode: 'immediate', interval_minutes: 60, grouping: 'digest',
};

const rssSummary = (r) =>
  `${r.scope === 'all' ? 'Tüm beslemeler' : `${r.feed_ids.length} besleme`} · ` +
  `${formatInterval(r.effective_interval_minutes)} · ${r.grouping === 'digest' ? 'tek özet' : 'her makale ayrı'}`;

export function RssRulesModal({ list, onClose, showToast }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API()}/rss-reader/lists/${list.id}/notification-rules`);
      if (!res.ok) throw new Error();
      setRules(await res.json());
    } catch (_) {
      showToast('Bildirim kuralları yüklenemedi.', 'error');
      setRules([]);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [list.id]);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) { showToast('Kural adı gerekli.', 'error'); return; }
    if (form.scope === 'selected' && form.feed_ids.length === 0) {
      showToast('En az bir besleme seç.', 'error'); return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      scope: form.scope,
      feed_ids: form.scope === 'selected' ? form.feed_ids : null,
      mode: form.mode,
      interval_minutes: form.mode === 'interval' ? form.interval_minutes : null,
      grouping: form.grouping,
    };
    try {
      const res = form.id
        ? await fetchWithAuth(`${API()}/rss-reader/notification-rules/${form.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await fetchWithAuth(`${API()}/rss-reader/lists/${list.id}/notification-rules`, { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || '');
      showToast(form.id ? 'Kural güncellendi.' : 'Kural eklendi.', 'success');
      setForm(null);
      load();
    } catch (e) { showToast(e?.message || 'Kaydedilemedi.', 'error'); }
    finally { setSaving(false); }
  };

  const toggle = async (rule) => {
    setRules(p => p.map(r => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    try {
      const res = await fetchWithAuth(`${API()}/rss-reader/notification-rules/${rule.id}`, {
        method: 'PATCH', body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error();
    } catch (_) {
      setRules(p => p.map(r => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      showToast('Değiştirilemedi.', 'error');
    }
  };

  const remove = async (id) => {
    try {
      const res = await fetchWithAuth(`${API()}/rss-reader/notification-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setRules(p => p.filter(r => r.id !== id));
      showToast('Kural silindi.', 'success');
    } catch (_) { showToast('Silinemedi.', 'error'); }
  };

  const toggleFeed = (feedId) => setForm(p => ({
    ...p,
    feed_ids: p.feed_ids.includes(feedId) ? p.feed_ids.filter(i => i !== feedId) : [...p.feed_ids, feedId],
  }));

  return (
    <ModalShell
      title="🔔 Bildirim Kuralları"
      subtitle={`${list.name} · bildirimler telefona gider`}
      onClose={onClose}
    >
      {!form ? (
        <>
          {loading ? (
            <p style={{ color: '#475569', textAlign: 'center', margin: '24px 0' }}>Yükleniyor…</p>
          ) : rules.length === 0 ? (
            <p style={{ color: '#475569', textAlign: 'center', margin: '24px 0' }}>Henüz kural yok.</p>
          ) : rules.map(r => (
            <div key={r.id} style={ui.ruleRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', fontWeight: 700 }}>{r.name}</div>
                <div style={{ color: '#475569', fontSize: '0.72rem', marginTop: '2px' }}>{rssSummary(r)}</div>
                {!r.ready && <div style={{ color: '#fbbf24', fontSize: '0.68rem', marginTop: '2px' }}>⏳ ilk tarama sürüyor…</div>}
              </div>
              <Toggle checked={!!r.enabled} onChange={() => toggle(r)} />
              <RuleActions
                onEdit={() => setForm({
                  id: r.id, name: r.name, scope: r.scope, feed_ids: r.feed_ids || [],
                  mode: r.mode, interval_minutes: r.interval_minutes || 60, grouping: r.grouping,
                })}
                onDelete={() => remove(r.id)}
              />
            </div>
          ))}

          <button type="button" onClick={() => setForm({ ...EMPTY_RSS_RULE })}
            style={{ ...ui.btn('ghost'), marginTop: '14px' }}>+ Yeni kural</button>
        </>
      ) : (
        <>
          <label style={ui.label}>Kural adı</label>
          <input style={ui.input} placeholder="Kritik açıklar" value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />

          <label style={ui.label}>Hangi beslemeler?</label>
          <div style={ui.row}>
            {[{ k: 'all', l: 'Tüm beslemeler' }, { k: 'selected', l: 'Seçili beslemeler' }].map(o => (
              <button key={o.k} type="button" style={ui.chip(form.scope === o.k)}
                onClick={() => setForm(p => ({ ...p, scope: o.k }))}>{o.l}</button>
            ))}
          </div>

          {form.scope === 'selected' && (
            <div style={{ ...ui.row, marginTop: '10px' }}>
              {(list.feeds || []).map(f => (
                <button key={f.id} type="button" style={ui.chip(form.feed_ids.includes(f.id))}
                  onClick={() => toggleFeed(f.id)}>{f.title || f.url}</button>
              ))}
            </div>
          )}

          <ScheduleFields form={form} setForm={setForm} itemWord="makale" />

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button type="button" onClick={save} disabled={saving} style={ui.btn('primary')}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={() => setForm(null)} style={ui.btn('ghost')}>Vazgeç</button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
