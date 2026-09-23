export const $ = (selector, root = document) => root.querySelector(selector);

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function clip(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function cap(value) {
  const s = String(value || '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function pct(number) {
  return `${Math.round((Number(number) || 0) * 100)}%`;
}

export function uid() {
  return `m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function fmtTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function listJoin(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}
