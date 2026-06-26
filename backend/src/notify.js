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
// Discord bot token for sending DMs to users
const DISCORD_BOT_TOKEN = (process.env.DISCORD_BOT_TOKEN || '').trim();
// Discord guild invite link for users to join
export const DISCORD_SERVER_LINK = 'https://discord.com/invite/8wPzZkGy5Z';
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
export const hasDiscordBot = () => !!DISCORD_BOT_TOKEN;

// POST JSON with a hard timeout. Resolves to a small result object and never
// throws, so fire-and-forget callers can't trigger unhandled rejections.
async function postJson(url, payload, headers = { 'Content-Type': 'application/json' }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
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

// Get Discord user ID from username (requires the bot to share a server with the user)
async function getDiscordUserId(username) {
  if (!DISCORD_BOT_TOKEN) return null;
  try {
    // Search for user by username (Discord API limitation: this only works if bot shares a server)
    // Alternative: require users to provide their Discord User ID directly
    const res = await fetch(`https://discord.com/api/v10/users/@me`, {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    // For now, we return the username as-is - actual DM requires User ID
    // Users need to provide their Discord User ID for DMs to work reliably
    return username; // Return as-is; the DM function will handle the actual sending
  } catch (e) {
    console.warn('[discord] failed to get user ID:', e.message);
    return null;
  }
}

// Send a DM to a Discord user via bot (requires user to be in a shared server)
export async function sendDiscordDM({ discordUsername, content, embed }) {
  if (!DISCORD_BOT_TOKEN) {
    console.log('[discord] (no DISCORD_BOT_TOKEN) would DM', discordUsername);
    return { ok: false, skipped: true, error: 'no bot token' };
  }
  try {
    let userId = discordUsername;

    // If it's a username (not just numbers), try to find the user ID
    if (!/^\d+$/.test(discordUsername)) {
      console.log(`[discord] Looking up user "${discordUsername}" in guild...`);

      let apiFailed = false;
      try {
        const membersRes = await fetch(
          `https://discord.com/api/v10/guilds/1512337763536601169/members?limit=1000`,
          { headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}` } }
        );

        if (!membersRes.ok) {
          const errText = await membersRes.text();
          console.error('[discord] guild API error:', errText);
          // Check if it's an auth issue
          if (membersRes.status === 401 || membersRes.status === 403) {
            return { ok: false, error: 'Cannot access Discord guild. Bot token may be invalid or expired.' };
          }
          apiFailed = true;
        } else {
          const members = await membersRes.json();
          const match = members.find(m =>
            m.user?.username?.toLowerCase() === discordUsername.toLowerCase() ||
            m.nick?.toLowerCase() === discordUsername.toLowerCase()
          );

          if (match?.user?.id) {
            userId = match.user.id;
            console.log(`[discord] Found user "${discordUsername}" as ${userId}`);
          }
        }
      } catch (e) {
        console.warn(`[discord] Could not search guild members:`, e.message);
        apiFailed = true;
      }

      // If API failed or user not found, return appropriate error
      if (apiFailed || !/^\d+$/.test(userId)) {
        return {
          ok: false,
          error: `User "${discordUsername}" not found. Make sure they are in the Synthica Discord server.`
        };
      }

      // If we still don't have a user ID, the user might not be in the server
      if (!/^\d+$/.test(userId)) {
        return {
          ok: false,
          error: `User "${discordUsername}" not found. Make sure they are in the Synthica Discord server.`
        };
      }
    }

    // Create a DM channel with the user
    const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmResponse.ok) {
      const err = await dmResponse.text();
      console.error('[discord] failed to create DM channel:', err);
      if (err.includes('403') || err.includes('Cannot send messages to this user')) {
        return { ok: false, error: 'User has DMs disabled. They need to allow DMs from server members in Discord settings.' };
      }
      return { ok: false, error: `Failed to create DM: ${err}` };
    }

    const dmChannel = await dmResponse.json();

    // Send the message
    const payload = { channel_id: dmChannel.id };
    if (content) payload.content = content;
    if (embed) payload.embeds = [embed];

    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!msgRes.ok) {
      const err = await msgRes.text();
      console.error('[discord] failed to send message:', err);
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (e) {
    console.error('[discord] DM error:', e);
    return { ok: false, error: e.message };
  }
}

function formatDiscordNotification({ type, title, body, link }) {
  const fields = [];
  if (title) fields.push({ name: 'Notification', value: title, inline: false });
  if (body) fields.push({ name: 'Details', value: body, inline: false });
  if (link) fields.push({ name: 'Action', value: `[View on Synthica](${link})`, inline: false });
  
  return {
    username: 'Synthica',
    embeds: [{
      title: `🔔 ${title || 'New notification'}`,
      description: body || '',
      color: 0x2589ed, // Synthica brand blue
      fields,
      footer: { text: 'Synthica Notifications' },
      timestamp: new Date().toISOString(),
    }],
  };
}

// Send notification via Discord DM (fire-and-forget)
export function notifyDiscord({ discordUsername, type, title, body, link }) {
  if (!DISCORD_BOT_TOKEN && !discordUsername) return;
  const payload = formatDiscordNotification({ type, title, body, link });
  // Fire and forget
  sendDiscordDM({ discordUsername, content: null, embed: payload.embeds[0] }).catch(() => {});
}

// Called from the workflow whenever a paper advances or is declined.
export function notifyMove({ title, paperId, category, label, decision }) {
  if (!webhookUrl && !whatsappUrl) return;
  const kind = decision === 'declined' ? 'declined' : decision === 'published' ? 'published' : 'move';
  const embed = {
    title:
      kind === 'declined' ? 'Paper declined' : kind === 'published' ? 'Paper ready to publish' : 'Paper moved up',
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
    content: "Synthica webhook connected — you'll get editorial queue updates here.",
  });
}
