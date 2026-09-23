import { CAT_LABEL, DEC_LABEL, DEC_TONE, AUDIENCE_LABEL, CONCERN_LABEL, DIRECTORY, AGENTS, STAGE_GROUPS, STAGE_KEYS, PRESETS } from './config.js';
import { $, esc, cap, pct, fmtTime } from './utils.js';
import { state, revealed, openDetails, uiFlags, statusText, toneOf, currentStageText, openModCount, canAppeal, showsResource } from './state.js';
import { getSampleState, maskPII, delegation } from './safety-pipeline.js';

export const ta = $('#compose');

let rafPending = false;

export function render() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderNow();
  });
}

export function renderNow() {
  renderChrome();
  renderThread();
  renderInspector();
  updateComposer();
}

function renderChrome() {
  document.querySelectorAll('.views [data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
  });

  const count = openModCount();
  const badge = $('#mod-badge');
  badge.hidden = count === 0;
  badge.textContent = String(count);
  badge.setAttribute('aria-label', `${count} open`);

  const head = {
    sender: ['Y', 'You', 'Sending to yourself. Each message is screened before it\'s delivered.', 'View as recipient'],
    recipient: ['Y', 'Your inbox', 'What the recipient sees. Only delivered messages arrive here.', 'View as sender'],
    moderator: ['M', 'Moderator queue', 'Safety alerts, held messages, and review requests.', 'Back to sender']
  }[state.view];

  $('#avatar').textContent = head[0];
  $('#chat-title').textContent = head[1];
  $('#chat-sub').textContent = head[2];
  $('#swap').textContent = head[3];
  $('#composer').hidden = state.view !== 'sender';
  $('#recip-foot').hidden = state.view !== 'recipient';

  const banner = $('#banner');
  let text = '';
  const sampleState = getSampleState();
  if (sampleState === 'unavailable') {
    text = "Screening needs Claude, which isn't available here. Open this page in the Claude app or claude.ai, or start the standalone backend server (see README) and reload. Nothing is delivered without screening.";
  } else if (sampleState === 'denied') {
    text = "Claude access was declined for this page, so messages can't be screened or sent. Reload the page to be asked again.";
  }
  banner.hidden = !text || state.view !== 'sender';
  banner.textContent = text;
}

function emptyState(view) {
  const copy = {
    sender: ['Send yourself a message', "SafeSignal screens it before delivery. Pick a test message below or write your own, then switch to the recipient view to see what arrived."],
    recipient: ['Nothing delivered yet', 'Messages show up here only after they pass screening.'],
    moderator: ['The queue is empty', 'Safety alerts, messages held for review, and review requests show up here.']
  }[view];
  return `<div class="empty"><strong>${copy[0]}</strong>${copy[1]}</div>`;
}

function renderThread() {
  const element = $('#thread');
  const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fkey : null;

  let html;
  if (state.view === 'sender') {
    html = state.messages.length ? state.messages.map(senderMsg).join('') : emptyState('sender');
  } else if (state.view === 'recipient') {
    html = recipientThread();
  } else {
    html = moderatorQueue();
  }

  element.innerHTML = html;

  if (focusKey) {
    const node = element.querySelector(`[data-fkey="${CSS.escape(focusKey)}"]`);
    if (node) node.focus({ preventScroll: true });
  }

  if (state.view === 'moderator') {
    if (uiFlags.forceScroll) element.scrollTop = 0;
  } else if (uiFlags.forceScroll || nearBottom) {
    element.scrollTop = element.scrollHeight;
  }
  uiFlags.forceScroll = false;
}

function btn(action, id, label, className = 'btn') {
  return `<button type="button" class="${className}" data-action="${action}" data-id="${id}" data-fkey="${action}:${id}">${label}</button>`;
}

function senderMsg(message) {
  const classes = ['msg', 'out'];
  if (message.id === state.selectedId) classes.push('selected');
  if (message.status === 'screening') classes.push('is-transit');
  else if (!message.delivered) classes.push('is-held');

  let html = `<article class="${classes.join(' ')}" data-id="${message.id}">`;
  html += `<button type="button" class="bubble" data-action="select" data-id="${message.id}" data-fkey="select:${message.id}" aria-describedby="st-${message.id}">${esc(message.text)}</button>`;

  if (message.status === 'screening') {
    const pips = STAGE_KEYS.map((key) => `<span class="${message.stages[key].state}"></span>`).join('');
    html += `<div class="status tone-brand" id="st-${message.id}"><div class="transit" aria-hidden="true">${pips}</div><span>${currentStageText(message)}</span>${btn('cancel', message.id, 'Cancel', 'btn-quiet')}</div>`;
  } else {
    html += `<div class="status tone-${toneOf(message)}" id="st-${message.id}"><span class="pip" aria-hidden="true"></span><span>${statusText(message)}</span><time>${fmtTime(message.createdAt)}</time>${btn('report', message.id, 'See report', 'btn-quiet')}</div>`;
  }

  html += senderPanel(message);
  if (showsResource(message, 'sender')) html += resourceCard(message);
  return `${html}</article>`;
}

function senderPanel(message) {
  const id = message.id;
  if (message.status === 'error') {
    return `<div class="notice tone-stop"><p class="notice-title">Not sent</p><p>${esc(message.error)}</p><div class="actions">${btn('retry', id, 'Try again', 'btn btn-primary')}${btn('edit', id, 'Edit message')}</div></div>`;
  }
  if (message.status === 'cancelled') {
    return `<div class="actions">${btn('retry', id, 'Screen and send')}${btn('edit', id, 'Edit message')}</div>`;
  }

  const final = message.final;
  if (!final) return '';

  const guidance = final.sender_guidance ? `<p class="guidance">${esc(final.sender_guidance)}</p>` : '';
  const rewrite = final.suggested_rewrite ? `<div class="rewrite"><p class="rewrite-label">A safer way to say it</p><p>${esc(final.suggested_rewrite)}</p></div>` : '';
  const useBtn = final.suggested_rewrite ? btn('use-suggestion', id, 'Use suggestion', 'btn btn-primary') : '';
  const editBtn = btn('edit', id, 'Edit message');
  const appealBtn = canAppeal(message) ? btn('appeal', id, 'Request a review') : '';
  const appealNote = message.mod.appeal ? `<p class="guidance">${{ pending: "Review requested. It's waiting in this demo's moderator queue.", upheld: 'A moderator reviewed your request and kept the decision.', overturned: 'A moderator reviewed your request and reversed the decision.' }[message.mod.appeal]}</p>` : '';

  const actions = (...buttons) => {
    const joined = buttons.join('');
    return joined ? `<div class="actions">${joined}</div>` : '';
  };

  switch (message.status) {
    case 'warned':
      return `<div class="notice tone-caution"><p class="notice-title">Before you send</p><p>${esc(final.user_message)}</p>${guidance}${rewrite}${actions(useBtn, editBtn, btn('send-anyway', id, 'Send as written'))}</div>`;
    case 'blocked':
      return `<div class="notice tone-stop"><p class="notice-title">Not delivered</p><p>${esc(final.user_message)}</p>${guidance}${rewrite}${appealNote}${actions(useBtn, editBtn, appealBtn)}</div>`;
    case 'review':
      return `<div class="notice tone-review"><p class="notice-title">Held for review</p><p>${esc(final.user_message)}</p></div>`;
    case 'rejected':
      return `<div class="notice tone-stop"><p class="notice-title">Not delivered after review</p><p>${esc(final.user_message)}</p>${rewrite}${actions(useBtn, editBtn)}</div>`;
    case 'delivered':
      if (final.decision === 'escalate' && !message.via) return `<div class="notice tone-review"><p class="notice-title">Delivered with a safety check</p><p>${esc(final.user_message)}</p>${appealNote}${actions(appealBtn)}</div>`;
      return '';
  }
  return '';
}

function resourceCard(message) {
  const wellbeing = message.final.wellbeing_resource;
  const list = (message.resources || []).map((id) => DIRECTORY.find((resource) => resource.id === id)).filter(Boolean);
  const items = list.map((resource) => `<li><span class="res-name">${esc(resource.name)}</span><span class="res-contact">${esc(resource.contact)}</span>${resource.url ? `<a href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer">Visit website</a>` : ''}</li>`).join('');
  return `<aside class="resource" aria-label="Support resources"><p class="res-title">If you want support</p><p>${esc(wellbeing.resource_message)}</p><ul class="res-list">${items}</ul></aside>`;
}

function recipientThread() {
  const rows = [];

  for (const message of state.messages) {
    if (message.delivered) {
      rows.push(`<article class="msg in${message.id === state.selectedId ? ' selected' : ''}" data-id="${message.id}"><p class="meta">From you, as sender</p><button type="button" class="bubble" data-action="select" data-id="${message.id}" data-fkey="rselect:${message.id}">${esc(message.text)}</button><div class="status"><time>${fmtTime(message.createdAt)}</time></div></article>`);
    } else if (showsResource(message, 'recipient')) {
      rows.push('<p class="sys-note">A message sent to you was held because it may have been hurtful. You don\'t need to do anything.</p>');
    }

    if (showsResource(message, 'recipient')) {
      rows.push(`<div class="msg in">${resourceCard(message)}</div>`);
    }
  }

  return rows.length ? rows.join('') : emptyState('recipient');
}

function moderatorQueue() {
  const items = state.messages.filter((message) => message.final && message.mod && (message.mod.alert || message.mod.review || message.mod.appeal)).slice().reverse();
  if (!items.length) return emptyState('moderator');
  return `<p class="mod-intro">You're the moderator in this demo. Decisions here stay in your browser.</p>${items.map(modItem).join('')}`;
}

function modItem(message) {
  const final = message.final;
  const chips = [];
  if (message.mod.alert) chips.push(`<span class="chip tone-stop">${message.mod.alert === 'open' ? 'Safety alert' : 'Alert handled'}</span>`);
  if (message.mod.review) chips.push(`<span class="chip tone-review">${{ pending: 'Held for review', approved: 'Approved', kept: 'Kept held' }[message.mod.review]}</span>`);
  if (message.mod.appeal) chips.push(`<span class="chip tone-caution">${{ pending: 'Review requested', overturned: 'Decision reversed', upheld: 'Decision kept' }[message.mod.appeal]}</span>`);

  const maskedText = maskPII(message.text);
  const showDetail = revealed.has(message.id);
  let html = `<article class="mod-item${message.id === state.selectedId ? ' selected' : ''}" data-id="${message.id}">`;
  html += `<div class="mod-top">${chips.join('')}<time>${fmtTime(message.createdAt)}</time></div>`;
  html += `<button type="button" class="mod-text" data-action="select" data-id="${message.id}" data-fkey="mselect:${message.id}">${esc(showDetail ? message.text : maskedText)}</button>`;
  if (maskedText !== message.text) html += `<div>${btn('reveal', message.id, showDetail ? 'Hide private details' : 'Show private details', 'btn-quiet')}</div>`;
  html += `<dl class="mod-facts"><div><dt>Decision</dt><dd>${DEC_LABEL[final.decision]}</dd></div><div><dt>Category</dt><dd>${CAT_LABEL[final.category]}</dd></div><div><dt>Severity</dt><dd>${cap(final.severity)}</dd></div><div><dt>Confidence</dt><dd>${pct(final.confidence)}</dd></div></dl>`;
  if (final.rationale) html += `<p class="mod-p">${esc(final.rationale)}</p>`;
  if (message.moderator_note) html += `<p class="mod-p"><span class="mod-sub">Escalation note.</span> ${esc(message.moderator_note)}</p>`;
  if (message.protective_actions && message.protective_actions.length) html += `<div class="mod-p"><span class="mod-sub">Suggested protective steps</span><ul>${message.protective_actions.map((step) => `<li>${esc(step)}</li>`).join('')}</ul></div>`;
  if (final.wellbeing_resource.provided) html += `<p class="mod-p"><span class="mod-sub">Support offered.</span> ${esc(final.wellbeing_resource.resource_name)}, for the ${AUDIENCE_LABEL[final.wellbeing_resource.audience]}.</p>`;

  const actions = [];
  if (message.mod.review === 'pending') actions.push(btn('mod-approve', message.id, 'Approve and deliver', 'btn btn-primary'), btn('mod-keep', message.id, 'Keep held'));
  if (message.mod.appeal === 'pending') actions.push(btn('mod-overturn', message.id, 'Reverse the decision', 'btn btn-primary'), btn('mod-uphold', message.id, 'Keep the decision'));
  if (message.mod.alert === 'open') actions.push(btn('mod-handled', message.id, 'Mark alert handled'));
  if (actions.length) html += `<div class="actions">${actions.join('')}</div>`;

  return `${html}</article>`;
}

function renderInspector() {
  const element = $('#insp');
  const selected = state.messages.find((message) => message.id === state.selectedId) || state.messages[state.messages.length - 1];

  if (!selected) {
    element.innerHTML = `<header class="insp-head"><h2>Screening report</h2><p class="insp-note">Send a message and its report shows up here: what SafeSignal found, which agents ran, and the final decision JSON.</p></header>${aboutHtml()}`;
    return;
  }

  const analysis = selected.analysis;
  const final = selected.final;
  let html = `<header class="insp-head"><h2>Screening report</h2><p class="insp-msg">${esc(maskPII(selected.text))}</p><p class="insp-note">Demo inspector. In a real app, only the sender sees their own result, and moderators see escalations.</p></header>`;
  html += verdictHtml(selected);
  if (analysis) html += factsHtml(analysis, final);
  html += pipelineHtml(selected);
  if (selected.guards && selected.guards.length) html += `<section class="guards"><h3 class="sec-title">Policy guards applied</h3><ul>${selected.guards.map((guard) => `<li>${esc(guard)}</li>`).join('')}</ul></section>`;
  if (final) html += `<details class="json" data-key="final"${openDetails.has('final') ? ' open' : ''}><summary>Final decision JSON</summary><div class="json-tools">${btn('copy-json', selected.id, 'Copy JSON')}<span id="copy-status" role="status"></span></div><pre>${esc(JSON.stringify(final, null, 2))}</pre></details>`;
  if (analysis) html += `<details class="json" data-key="delegation"${openDetails.has('delegation') ? ' open' : ''}><summary>Analysis handed to specialists</summary><pre>${esc(JSON.stringify({ ...delegation(analysis, null), task: undefined, tasks: analysis.tasks }, null, 2))}</pre></details>`;
  html += aboutHtml();
  element.innerHTML = html;
}

function verdictHtml(message) {
  const final = message.final;
  if (message.status === 'screening') return `<section class="verdict tone-brand"><p class="verdict-word">Screening</p><p>${currentStageText(message)}. Nothing is delivered until screening finishes.</p></section>`;
  if (!final) return `<section class="verdict tone-${message.status === 'cancelled' ? 'muted' : 'stop'}"><p class="verdict-word">Not sent</p><p>${esc(message.status === 'cancelled' ? 'Screening was cancelled before a decision.' : message.error)}</p></section>`;
  return `<section class="verdict tone-${DEC_TONE[final.decision]}"><p class="verdict-word">${DEC_LABEL[final.decision]}</p><p>${esc(final.rationale)}</p><p class="verdict-action">What the app did: ${esc(statusText(message).toLowerCase())}.</p></section>`;
}

function factsHtml(analysis, final) {
  const yesNo = (value) => (value ? 'Yes' : 'No');
  const rows = [
    ['Category', CAT_LABEL[analysis.category]],
    ['Severity', cap(analysis.severity)],
    ['Confidence', `${pct(analysis.confidence)}<div class="conf" aria-hidden="true"><span style="width:${pct(analysis.confidence)}"></span></div>`, true],
    ['Targeted', yesNo(analysis.targeted)],
    ['Repeated behavior', yesNo(analysis.repeated_behavior)],
    ['Wellbeing concern', analysis.wellbeing_concern === 'none' ? 'None' : `${CONCERN_LABEL[analysis.wellbeing_concern]}`],
    ['Moderator alert', yesNo(analysis.moderator_alert)]
  ];

  if (final) {
    rows.push(['Appeal', final.appeal_available ? 'Available' : 'Not needed'], ['Privacy review', final.privacy_review_passed ? 'Passed' : 'Not passed']);
  }
  if (analysis.segment) rows.push(['Flagged segment', esc(analysis.segment), true]);
  return `<dl class="facts">${rows.map(([label, value, raw]) => `<div><dt>${label}</dt><dd>${raw ? value : esc(value)}</dd></div>`).join('')}</dl>`;
}

function pipelineHtml(message) {
  const groups = STAGE_GROUPS.map((group) => {
    const statuses = group.keys.map((key) => (message.stages[key] || {}).state || 'waiting');
    let groupState = 'waiting';
    if (statuses.some((status) => status === 'running')) groupState = 'running';
    else if (statuses.some((status) => status === 'failed')) groupState = 'failed';
    else if (statuses.every((status) => status === 'done' || status === 'skipped')) groupState = statuses.some((status) => status === 'done') ? 'done' : 'skipped';

    const agents = group.keys.map((key) => {
      const stage = message.stages[key] || { state: 'waiting' };
      const labels = { waiting: 'Waiting', running: 'Working', skipped: 'Skipped', failed: "Didn't finish", done: stage.ms != null ? `${(stage.ms / 1000).toFixed(1)} s` : 'Done' };
      return `<li class="agent a-${stage.state}"><p class="a-name">${AGENTS[key].name}</p><span class="a-state">${labels[stage.state]}</span><p class="a-role">${AGENTS[key].role}</p>${stage.summary ? `<p class="a-out">${esc(stage.summary)}</p>` : ''}</li>`;
    }).join('');

    return `<li class="stage g-${groupState}"><h4>${group.title}</h4><ul class="agents">${agents}</ul></li>`;
  }).join('');

  return `<section><h3 class="sec-title">How it was screened</h3><ol class="stages">${groups}</ol></section>`;
}

function aboutHtml() {
  return `<section class="about"><h3>About this demo</h3><p>Every message runs through the SafeSignal prompt as the orchestrator, then the specialist agents, then a privacy review, before anything is delivered. If screening fails, the message isn't sent. Support resources come from a fixed U.S. directory in the app, so agents can't invent phone numbers or links; verify every entry before a real deployment.</p></section>`;
}

export function autosize() {
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
}

export function updateComposer() {
  const sampleState = getSampleState();
  const blocked = sampleState === 'unavailable' || sampleState === 'denied';
  $('#send').disabled = !ta.value.trim() || blocked;
  ta.disabled = blocked;
}

export function announce(text) {
  const element = $('#announce');
  element.textContent = '';
  setTimeout(() => {
    element.textContent = text;
  }, 60);
}

export function buildPresets() {
  $('#presets').innerHTML = `<span class="presets-label">Try:</span>${PRESETS.map((preset, index) => `<button type="button" class="preset" data-action="preset" data-i="${index}">${esc(preset.label)}</button>`).join('')}`;
}
