// Outbound webhook notifier (Discord + a generic WhatsApp/relay channel).
//
// This module is the *external* fan-out for platform events. The *in-app*
// notification (the bell) + its live SSE push are handled by store.pushNotif,
// which writes a notification row and calls emit(userId, 'notification', …) so
// the recipient's open EventSource delivers it in near-real-time. These two
// layers are complementary: pushNotif → one specific user's bell; notifyEvent /
// notifyMove → a shared Discord/WhatsApp channel the whole team watches.
//
// Cross-role events that must reach a recipient's bell (produced by store.js via
// pushNotif): application submitted/approved/rejected, role granted, mentor
// booking created/cancelled, independent proposal submitted/approved/rejected,
// listing application accepted/rejected, paper decision/advance/published, and
// new direct message. notify.js mirrors the broadcastable ones to webhooks.
//
// The webhook URL is configured at runtime by the Director (PUT /editor/settings)
// or via the DISCORD_WEBHOOK_URL env var (which also makes it survive restarts).

let webhookUrl = (process.env.DISCORD_WEBHOOK_URL || '').trim();
// A second, generic channel — point it at a WhatsApp relay (Twilio/Make/Zapier
// webhook) that forwards a JSON {text} payload to a WhatsApp number/group.
let whatsappUrl = (process.env.WHATSAPP_WEBHOOK_URL || '').trim();

// Don't let a slow/hung webhook keep a request socket open forever. Fire-and-
// forget callers never await, but an un-aborted fetch can pile up under load.
const WEBHOOK_TIMEOUT_MS = 5000;

export const getWebhook = () => webhookUrl;
export const setWebhook = (url) => {
  webhookUrl = (url || '').trim();
  return webhookUrl;
};
export const getWhatsapp = () => whatsappUrl;
export const setWhatsapp = (url) => {
  whatsappUrl = (url || '').trim();
  return whatsappUrl;
};

// POST JSON with a hard timeout. Resolves to a small result object and never
// throws, so fire-and-forget callers can't trigger unhandled rejections.
async function postJson(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

function postWhatsapp(text) {
  if (!whatsappUrl) return Promise.resolve({ ok: false, skipped: true });
  return postJson(whatsappUrl, { text });
}

const COLOR = { move: 0x2589ed, published: 0xffd700, declined: 0xef4444 };

export async function postDiscord(payload) {
  if (!webhookUrl) return { ok: false, skipped: true };
  return postJson(webhookUrl, payload);
}

// Called from the workflow whenever a paper advances or is declined.
export function notifyMove({ title, paperId, category, label, decision }) {
  if (!webhookUrl && !whatsappUrl) return;
  const kind = decision === 'declined' ? 'declined' : decision === 'published' ? 'published' : 'move';
  const embed = {
    title:
      kind === 'declined' ? '❌ Paper declined' : kind === 'published' ? '🎉 Paper ready to publish' : '📤 Paper moved up',
    color: COLOR[kind],
    fields: [
      { name: 'Paper', value: `${title} (#${String(paperId).replace('paper_', '')})` },
      { name: 'Subject', value: category || '—', inline: true },
      { name: 'Status', value: label || '—', inline: true },
    ],
    footer: { text: 'Synthica editorial queue' },
    timestamp: new Date().toISOString(),
  };
  // Fire-and-forget so the request never blocks the workflow. Errors are
  // swallowed inside postJson; attach a no-op catch as belt-and-braces.
  postDiscord({ username: 'Synthica', embeds: [embed] }).catch(() => {});
  postWhatsapp(`${embed.title}: ${title} — ${label || ''}`).catch(() => {});
}

// Generic event ping (researcher-side events: applications, onboarding, etc.).
export function notifyEvent({ title, body }) {
  if (!webhookUrl && !whatsappUrl) return;
  postDiscord({
    username: 'Synthica',
    embeds: [{ title, description: body || '', color: COLOR.move, timestamp: new Date().toISOString() }],
  }).catch(() => {});
  postWhatsapp(`${title}: ${body || ''}`).catch(() => {});
}

export function sendTest() {
  return postDiscord({
    username: 'Synthica',
    content: "✅ Synthica webhook connected — you'll get editorial queue updates here.",
  });
}
