import { STORE_KEY, STAGE_KEYS } from './config.js';

export const state = { messages: [], view: 'sender', selectedId: null, tier: 'default' };

// Ephemeral, non-persisted UI state (not saved to localStorage).
export const revealed = new Set();
export const openDetails = new Set();
export const uiFlags = { forceScroll: true };

export function freshStages() {
  return Object.fromEntries(STAGE_KEYS.map((key) => [key, { state: 'waiting' }]));
}

export function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages)) {
      state.messages = data.messages.filter((message) => message && typeof message.text === 'string' && message.id);
    }
    if (['quick', 'default', 'complex'].includes(data.tier)) {
      state.tier = data.tier;
    }
    for (const message of state.messages) {
      message.mod = message.mod || {};
      message.stages = message.stages || freshStages();
      if (message.status === 'screening') {
        message.status = 'error';
        message.error = "Screening was interrupted when the page closed, so the message wasn't sent.";
        for (const key of STAGE_KEYS) {
          const stage = message.stages[key];
          if (stage && (stage.state === 'running' || stage.state === 'waiting')) stage.state = 'skipped';
        }
      }
    }
    state.selectedId = state.messages.length ? state.messages[state.messages.length - 1].id : null;
  } catch {
    // start fresh
  }
}

export function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ messages: state.messages, tier: state.tier }));
  } catch {
    // unavailable
  }
}

// Derived read-only views over a message, shared by the pipeline and the renderer.

export function statusText(message) {
  switch (message.status) {
    case 'screening':
      return 'Screening before delivery';
    case 'delivered':
      if (message.via === 'sender') return 'Delivered after you chose to send it';
      if (message.via === 'review') return 'Delivered after review';
      if (message.via === 'appeal') return 'Delivered after a review request';
      return message.final && message.final.decision === 'escalate' ? 'Delivered, flagged for a safety check' : 'Delivered';
    case 'warned':
      return 'Not sent yet';
    case 'blocked':
      return 'Not delivered';
    case 'review':
      return 'Held for review';
    case 'rejected':
      return 'Not delivered after review';
    case 'error':
      return "Couldn't screen, not sent";
    case 'cancelled':
      return 'Cancelled, not sent';
    case 'revised':
      return 'Not sent, replaced by a revision';
  }
  return '';
}

export function toneOf(message) {
  switch (message.status) {
    case 'delivered':
      return message.final && message.final.decision === 'escalate' && !message.via ? 'review' : 'clear';
    case 'warned':
      return 'caution';
    case 'blocked':
    case 'rejected':
    case 'error':
      return 'stop';
    case 'review':
      return 'review';
    case 'screening':
      return 'brand';
  }
  return 'muted';
}

export function currentStageText(message) {
  const stages = message.stages;
  if (stages.analysis.state === 'running' || stages.analysis.state === 'waiting') return 'SafeSignal is analyzing';
  if (['intervention', 'response', 'wellbeing', 'escalation'].some((key) => stages[key].state === 'running')) return 'Specialists are drafting a response';
  if (stages.privacy.state === 'running') return 'Checking privacy and fairness';
  return 'Deciding';
}

export function openModCount() {
  return state.messages.reduce((count, message) => count + (message.mod && message.mod.alert === 'open' ? 1 : 0) + (message.mod && message.mod.review === 'pending' ? 1 : 0) + (message.mod && message.mod.appeal === 'pending' ? 1 : 0), 0);
}

export function canAppeal(message) {
  const final = message.final;
  if (!final || !final.appeal_available || message.mod.appeal) return false;
  if (final.decision === 'escalate' && ['sender_distress', 'imminent_risk'].includes(final.wellbeing_resource.concern)) return false;
  return message.status === 'blocked' || (message.status === 'delivered' && final.decision === 'escalate' && !message.via);
}

export function showsResource(message, who) {
  const final = message.final;
  if (!final || !final.wellbeing_resource.provided) return false;
  const audience = final.wellbeing_resource.audience;
  if (who === 'sender') return (audience === 'sender' || audience === 'both') && message.status !== 'screening';
  return (audience === 'recipient' || audience === 'both') && (message.delivered || message.status === 'blocked' || message.status === 'rejected');
}
