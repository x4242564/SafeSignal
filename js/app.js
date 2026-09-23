import { PRESETS } from './config.js';
import { $, uid } from './utils.js';
import { state, load, save, revealed, openDetails, uiFlags, freshStages, canAppeal } from './state.js';
import { render, renderNow, ta, autosize, updateComposer, buildPresets, announce } from './render.js';
import { screen, runtime, getSample, setUserMessage } from './safety-pipeline.js';

function sendFromComposer() {
  const text = ta.value.trim();
  if (!text || $('#send').disabled) return;
  ta.value = '';
  autosize();
  updateComposer();

  const message = {
    id: uid(),
    text: text.slice(0, 1000),
    createdAt: Date.now(),
    status: 'screening',
    delivered: false,
    stages: freshStages(),
    mod: {}
  };

  state.messages.push(message);
  state.selectedId = message.id;
  uiFlags.forceScroll = true;
  screen(message);
}

function toComposer(text) {
  ta.value = text;
  autosize();
  updateComposer();
  if (state.view !== 'sender') {
    state.view = 'sender';
    uiFlags.forceScroll = true;
  }
  ta.focus();
}

let clearTimer = null;

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const message = id ? state.messages.find((item) => item.id === id) : null;

  switch (action) {
    case 'view':
      state.view = button.dataset.view;
      uiFlags.forceScroll = true;
      break;
    case 'swap':
      state.view = state.view === 'sender' ? 'recipient' : 'sender';
      uiFlags.forceScroll = true;
      break;
    case 'send':
      sendFromComposer();
      return;
    case 'preset':
      toComposer(PRESETS[Number(button.dataset.i)].text);
      break;
    case 'select':
      if (message) state.selectedId = message.id;
      break;
    case 'report':
      if (message) state.selectedId = message.id;
      if (window.matchMedia('(max-width: 900px)').matches) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() => $('#inspector').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }));
      }
      break;
    case 'cancel': {
      const controller = message && runtime.get(message.id);
      if (controller) controller.abort();
      return;
    }
    case 'retry':
      if (message && message.status !== 'screening') {
        state.selectedId = message.id;
        screen(message);
      }
      return;
    case 'edit':
      if (message) {
        if (message.status !== 'delivered') message.status = 'revised';
        toComposer(message.text);
      }
      break;
    case 'use-suggestion':
      if (message && message.final) {
        message.status = 'revised';
        toComposer(message.final.suggested_rewrite);
      }
      break;
    case 'send-anyway':
      if (message && message.final && message.status === 'warned') {
        message.delivered = true;
        message.status = 'delivered';
        message.via = 'sender';
        message.final.confirmed_application_action = 'delivered_after_sender_chose_to_send';
        setUserMessage(message, 'You chose to send it as written, and it was delivered.');
        announce('Delivered.');
      }
      break;
    case 'appeal':
      if (message && canAppeal(message)) {
        message.mod.appeal = 'pending';
        announce('Review requested.');
      }
      break;
    case 'mod-approve':
      if (message && message.mod.review === 'pending') {
        message.mod.review = 'approved';
        message.delivered = true;
        message.status = 'delivered';
        message.via = 'review';
        message.final.confirmed_application_action = 'delivered_after_demo_human_review';
        setUserMessage(message, 'A moderator reviewed it, and it was delivered.');
      }
      break;
    case 'mod-keep':
      if (message && message.mod.review === 'pending') {
        message.mod.review = 'kept';
        message.status = 'rejected';
        message.final.confirmed_application_action = 'not_delivered_after_demo_human_review';
        setUserMessage(message, "A moderator reviewed it, and it won't be delivered.");
      }
      break;
    case 'mod-overturn':
      if (message && message.mod.appeal === 'pending') {
        message.mod.appeal = 'overturned';
        if (message.mod.alert === 'open') message.mod.alert = 'handled';
        if (!message.delivered) {
          message.delivered = true;
          message.status = 'delivered';
          message.via = 'appeal';
          message.final.confirmed_application_action = 'delivered_after_demo_appeal';
          setUserMessage(message, 'A moderator reviewed your request, and it was delivered.');
        } else {
          message.via = 'appeal';
          message.final.confirmed_application_action = 'delivered; safety_flag_removed_after_demo_appeal';
        }
      }
      break;
    case 'mod-uphold':
      if (message && message.mod.appeal === 'pending') {
        message.mod.appeal = 'upheld';
      }
      break;
    case 'mod-handled':
      if (message && message.mod.alert === 'open') message.mod.alert = 'handled';
      break;
    case 'reveal':
      if (message) {
        revealed.has(message.id) ? revealed.delete(message.id) : revealed.add(message.id);
      }
      break;
    case 'copy-json':
      if (message && message.final) {
        const output = $('#copy-status');
        const update = (text) => {
          if (output) output.textContent = text;
        };
        try {
          navigator.clipboard.writeText(JSON.stringify(message.final, null, 2)).then(() => update('Copied.'), () => update("Couldn't copy. Select the text instead."));
        } catch {
          update("Couldn't copy. Select the text instead.");
        }
      }
      return;
    case 'clear':
      if (button.dataset.armed === '1') {
        for (const controller of runtime.values()) controller.abort();
        state.messages = [];
        state.selectedId = null;
        revealed.clear();
        button.dataset.armed = '';
        button.textContent = 'Clear conversation';
        if (clearTimer) clearTimer();
      } else {
        button.dataset.armed = '1';
        button.textContent = 'Click again to clear everything';
        const timer = setTimeout(() => {
          button.dataset.armed = '';
          button.textContent = 'Clear conversation';
        }, 3500);
        clearTimer = () => clearTimeout(timer);
        return;
      }
      break;
    default:
      return;
  }

  save();
  render();
});

document.addEventListener('toggle', (event) => {
  const details = event.target;
  if (details && details.matches && details.matches('details[data-key]')) {
    if (details.open) openDetails.add(details.dataset.key);
    else openDetails.delete(details.dataset.key);
  }
}, true);

ta.addEventListener('input', () => {
  autosize();
  updateComposer();
});

ta.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendFromComposer();
  }
});

$('#tier').addEventListener('change', (event) => {
  state.tier = event.target.value;
  save();
});

load();
buildPresets();
$('#tier').value = state.tier;
renderNow();
getSample();
