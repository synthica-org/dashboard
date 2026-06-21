// Weekly digest — a personalized "your week" email: what people you follow did,
// plus open programs, project spots, and deadlines. Branded HTML (+ plaintext).
//
// Scheduling: server.js runs maybeSendWeekly() hourly when ENABLE_DIGESTS=true.
// On free-tier hosts that sleep, prefer hitting POST /api/admin/digest/send
// from an external cron (or the Admin page button) instead.

import { sendEmail, emailLayout, emailBox } from './email.js';

const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const BRAND = process.env.EMAIL_BRAND || 'Synthica';
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Plaintext fallback (also used when no email provider is configured).
export function buildDigestText(name, { activity = [], listings = [], programs = [], events = [] }) {
  const parts = [`Hi ${name || 'researcher'},\n\nHere's your ${BRAND} week:`];
  if (activity.length) {
    parts.push('👥 From people you follow:\n' + activity.map((a) => `  • ${a.actorName} ${a.text}`).join('\n'));
  }
  if (programs.length) {
    parts.push('🎓 Programs open for applications:\n' + programs.map((p) => `  • ${p.title}${p.cohortLabel ? ` (${p.cohortLabel})` : ''}${p.applyDeadline ? ` — apply by ${day(p.applyDeadline)}` : ''}`).join('\n'));
  }
  if (listings.length) {
    parts.push('🔬 Open project spots:\n' + listings.slice(0, 6).map((l) => `  • ${l.title} (${l.category}${l.spots ? `, ${l.spots} spots` : ''})${l.leadName ? ` — led by ${l.leadName}` : ''}`).join('\n'));
  }
  if (events.length) {
    parts.push('📅 Deadlines in the next 7 days:\n' + events.map((e) => `  • ${day(e.dueAt)} — ${e.title}`).join('\n'));
  }
  if (parts.length === 1) parts.push('A quiet week — a good time to start something new.');
  parts.push(`Jump back in: ${FRONTEND_URL || 'https://app.synthica.org'}/researcher\n\n— The ${BRAND} Team`);
  return parts.join('\n\n');
}

// Branded HTML body for one recipient.
function buildDigestHtml(name, { activity = [], listings = [], programs = [], events = [] }) {
  const blocks = [];
  if (activity.length) {
    blocks.push(emailBox('👥 From people you follow', activity.map((a) => `<strong>${esc(a.actorName)}</strong> ${esc(a.text)}`).join('<br>')));
  }
  if (programs.length) {
    blocks.push(emailBox('🎓 Programs open', programs.map((p) => `${esc(p.title)}${p.cohortLabel ? ` (${esc(p.cohortLabel)})` : ''}${p.applyDeadline ? ` — apply by ${esc(day(p.applyDeadline))}` : ''}`).join('<br>')));
  }
  if (listings.length) {
    blocks.push(emailBox('🔬 Open project spots', listings.slice(0, 6).map((l) => `${esc(l.title)} (${esc(l.category)}${l.spots ? `, ${l.spots} spots` : ''})`).join('<br>')));
  }
  if (events.length) {
    blocks.push(emailBox('📅 Deadlines this week', events.map((e) => `${esc(day(e.dueAt))} — ${esc(e.title)}`).join('<br>')));
  }
  if (!blocks.length) blocks.push('A quiet week — a good time to start something new. 🌱');
  return emailLayout({
    heading: `Your ${BRAND} week`,
    intro: `Hi ${esc(String(name || 'there').split(/\s+/)[0])}, here's what's happening with your network and across the community.`,
    blocks,
    button: { label: 'Open the portal', url: `${FRONTEND_URL || 'https://app.synthica.org'}/researcher` },
    signoff: 'See you in there,',
  });
}

// Sends a personalized digest to every approved researcher with an email.
// `activityFor(userId)` returns that member's recent followed-activity.
export async function sendWeeklyDigests(data, activityFor = () => []) {
  const { recipients = [], ...sections } = data || {};
  let sent = 0;
  for (const r of recipients) {
    if (!r || !r.email) continue; // skip recipients with no email on file
    const personal = { ...sections, activity: activityFor(r.id) || [] };
    const res = await sendEmail({
      to: r.email,
      subject: `Your ${BRAND} week: your network, programs & deadlines`,
      html: buildDigestHtml(r.name, personal),
      text: buildDigestText(r.name, personal),
    });
    if (res.ok || res.skipped) sent++;
  }
  return { recipients: recipients.length, sent };
}

// Fire once a week (Monday, 13:00–13:59 UTC). The caller invokes this hourly;
// the module remembers the last send so a long-lived process won't repeat it.
let lastSentAt = 0;
export async function maybeSendWeekly(getData, activityFor) {
  const now = new Date();
  const isWindow = now.getUTCDay() === 1 && now.getUTCHours() === 13;
  const sentRecently = Date.now() - lastSentAt < 6 * 24 * 3600 * 1000;
  if (!isWindow || sentRecently) return null;
  lastSentAt = Date.now();
  const out = await sendWeeklyDigests(getData(), activityFor);
  console.log(`[digest] weekly digest sent to ${out.sent}/${out.recipients} researchers`);
  return out;
}
