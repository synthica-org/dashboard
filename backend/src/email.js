// Transactional email — pluggable. Uses Resend (https://resend.com) when
// RESEND_API_KEY is set; otherwise logs to the console (no-op) so the app runs
// without an email provider. Fire-and-forget; never blocks the workflow.

const API_KEY = process.env.RESEND_API_KEY || '';
const FROM = process.env.EMAIL_FROM || 'Synthica <noreply@synthica.org>';
const BRAND = process.env.EMAIL_BRAND || 'Synthica';
const SITE = (process.env.FRONTEND_URL || 'https://app.synthica.org').replace(/\/$/, '');

// Whether real email delivery is configured. Without it, verification, password
// reset, and digests are silently logged-only — surfaced via /api/config so the
// Admin page can warn that those flows won't actually send.
export const emailEnabled = () => !!API_KEY;

// Accepts an optional `html` body; Resend sends multipart when both are present.
export async function sendEmail({ to, subject, text, html }) {
  if (!to) return { ok: false, skipped: true };
  if (!API_KEY) {
    console.log(`[email] (no RESEND_API_KEY) would send to ${to}: ${subject}`);
    return { ok: false, skipped: true };
  }
  try {
    const body = { from: FROM, to, subject };
    if (text) body.text = text;
    if (html) body.html = html;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Branded, email-client-safe HTML layout (inline styles, table wrapper, 600px).
// `blocks` is an array of HTML strings; `button` is { label, url } (optional).
export function emailLayout({ heading, intro, blocks = [], button, signoff = `Welcome to ${BRAND}!` }) {
  const btn = button
    ? `<tr><td style="padding:8px 0 4px;">
        <a href="${esc(button.url)}" style="display:inline-block;background:#2589ed;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px;">${esc(button.label)} &rarr;</a>
      </td></tr>`
    : '';
  const body = blocks.map((b) => `<tr><td style="padding:6px 0;color:#334155;font-size:15px;line-height:1.65;">${b}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef4fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(8,40,80,0.08);">
        <tr><td style="background:linear-gradient(135deg,#0c2d54,#2589ed);padding:26px 32px;">
          <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.02em;">${esc(BRAND)}</span>
        </td></tr>
        <tr><td style="padding:30px 32px 8px;">
          <h1 style="margin:0 0 10px;font-size:22px;color:#0f172a;">${esc(heading)}</h1>
          ${intro ? `<p style="margin:0 0 8px;color:#334155;font-size:15px;line-height:1.65;">${intro}</p>` : ''}
        </td></tr>
        <tr><td style="padding:0 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}${btn}</table>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;color:#0f172a;font-size:15px;">
          <p style="margin:0;">${esc(signoff)}<br><span style="color:#64748b;">The ${esc(BRAND)} Team</span></p>
        </td></tr>
        <tr><td style="background:#f6f8fc;padding:18px 32px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;line-height:1.6;">
          You're receiving this because you have a ${esc(BRAND)} account.
          <a href="${esc(SITE)}" style="color:#2589ed;text-decoration:none;">${esc(SITE.replace(/^https?:\/\//, ''))}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// A highlighted "to-do" / info box for use inside a layout block.
export function emailBox(title, html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;background:#f1f6fd;border-left:3px solid #2589ed;border-radius:0 10px 10px 0;">
    <tr><td style="padding:12px 16px;color:#334155;font-size:14px;line-height:1.6;">
      <strong style="color:#0f172a;display:block;margin-bottom:4px;">${esc(title)}</strong>${html}
    </td></tr></table>`;
}

// The welcome email sent on sign-up (branded HTML + plaintext fallback).
export function welcomeEmail({ name, verifyUrl, communityUrl }) {
  const first = String(name || 'there').split(/\s+/)[0];
  const html = emailLayout({
    heading: `Welcome to ${BRAND}, ${esc(first)}!`,
    intro: `Thank you so much for joining the ${esc(BRAND)} community! We're beyond excited to have you onboard.`,
    blocks: [
      `${esc(BRAND)} is a global community for students offering free, accessible opportunities — from competitions, workshops, and mentorship to real research and publication.`,
      emailBox('Your to-dos', `${verifyUrl ? `Confirm your email to finish setting up your account.<br>` : ''}Complete your profile and introduce yourself to the community.`),
      `On a regular basis we run guest-speaker sessions, launch new events, and open competitions — all free, and always will be. All members get unlimited access.`,
    ],
    button: verifyUrl ? { label: 'Confirm your email', url: verifyUrl } : (communityUrl ? { label: 'Open the portal', url: communityUrl } : undefined),
    signoff: `Welcome aboard!`,
  });
  const text = `Hi ${first},\n\nWelcome to ${BRAND}! We're excited to have you.\n\n${BRAND} is a global community for students with free competitions, workshops, mentorship, and publication opportunities.\n\nTo-dos:\n- ${verifyUrl ? `Confirm your email: ${verifyUrl}\n- ` : ''}Complete your profile and say hello.\n\nWelcome aboard,\nThe ${BRAND} Team\n${SITE}`;
  return { subject: `Welcome to ${BRAND}, ${first}!`, html, text };
}

// Generic branded action email (verification, password reset, role approval…).
export function actionEmail({ to, subject, heading, intro, blocks, button, signoff }) {
  return sendEmail({ to, subject, html: emailLayout({ heading, intro, blocks, button, signoff }), text: stripHtml(`${intro || ''}\n\n${(blocks || []).join('\n\n')}\n\n${button ? button.url : ''}`) });
}

const stripHtml = (s) => String(s).replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

// Notify a paper's author of a final decision (branded HTML).
export function emailDecision({ authorEmail, authorName, title, decision }) {
  if (!authorEmail) return;
  const published = decision === 'published';
  const first = String(authorName || 'researcher').split(/\s+/)[0];
  return actionEmail({
    to: authorEmail,
    subject: published ? `Your ${BRAND} submission has been accepted: ${title}` : `Update on your ${BRAND} submission: ${title}`,
    heading: published ? 'Your paper was accepted' : 'Submission update',
    intro: `Hi ${esc(first)},`,
    blocks: published
      ? [`Great news — <strong>“${esc(title)}”</strong> has cleared editorial review and is being prepared for publication in the ${esc(BRAND)} Journal. We'll follow up with next steps.`]
      : [`Thank you for submitting <strong>“${esc(title)}”</strong> to the ${esc(BRAND)} Journal. After review, it was not accepted at this time — we'd welcome a revised version or future work.`],
    signoff: 'Thank you for contributing,',
  });
}

// ============================================================
// Notification email templates for platform events
// ============================================================

// New reply/comment on post
export function emailNewComment({ toEmail, toName, authorName, postTitle, postLink }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `${authorName} commented on your post`,
    heading: 'New comment on your post',
    intro: `Hi ${esc(first)},`,
    blocks: [
      `<strong>${esc(authorName)}</strong> commented on your post<strong>${esc(postTitle)}</strong>`,
    ],
    button: { label: 'View comment', url: `${SITE}${postLink}` },
    signoff: 'Stay engaged,',
  });
}

// Project invitation received
export function emailProjectInvite({ toEmail, toName, inviterName, projectTitle, projectLink }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `You've been invited to join: ${projectTitle}`,
    heading: 'Project invitation',
    intro: `Hi ${esc(first)},`,
    blocks: [
      `<strong>${esc(inviterName)}</strong> invited you to join the project <strong>${esc(projectTitle)}</strong>`,
    ],
    button: { label: 'View project', url: `${SITE}${projectLink}` },
    signoff: 'Happy collaborating,',
  });
}

// Application status update
export function emailApplicationUpdate({ toEmail, toName, programName, status, statusMessage, link }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  const statusLabel = status === 'approved' ? 'approved' : status === 'rejected' ? 'not approved' : 'updated';
  return actionEmail({
    to: toEmail,
    subject: `Your application to ${programName} was ${statusLabel}`,
    heading: `Application ${statusLabel}`,
    intro: `Hi ${esc(first)},`,
    blocks: [
      statusMessage || `Your application to <strong>${esc(programName)}</strong> has been ${statusLabel}.`,
    ],
    button: link ? { label: 'View application', url: `${SITE}${link}` } : undefined,
    signoff: 'Best regards,',
  });
}

// Mentor request received
export function emailMentorRequest({ toEmail, toName, menteeName, menteeMessage, requestLink }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `New mentorship request from ${menteeName}`,
    heading: 'New mentorship request',
    intro: `Hi ${esc(first)},`,
    blocks: [
      `<strong>${esc(menteeName)}</strong> requested your mentorship.`,
      menteeMessage ? `Message: <em>"${esc(menteeMessage)}"</em>` : '',
    ],
    button: { label: 'View request', url: `${SITE}${requestLink}` },
    signoff: 'Happy mentoring,',
  });
}

// New community announcement
export function emailAnnouncement({ toEmail, toName, authorName, title, content, link }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `Announcement: ${title}`,
    heading: esc(title),
    intro: `Hi ${esc(first)},`,
    blocks: [
      `From <strong>${esc(authorName)}</strong>:`,
      content || '',
    ],
    button: link ? { label: 'Read more', url: `${SITE}${link}` } : undefined,
    signoff: 'Stay connected,',
  });
}

// Role/privilege granted
export function emailRoleGranted({ toEmail, toName, roleName, roleDescription, dashboardLink }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `You've been granted: ${roleName}`,
    heading: 'New role assigned',
    intro: `Hi ${esc(first)},`,
    blocks: [
      `Congratulations! You've been assigned the <strong>${esc(roleName)}</strong> role.`,
      roleDescription || '',
    ],
    button: { label: 'Go to dashboard', url: `${SITE}${dashboardLink}` },
    signoff: 'Congratulations,',
  });
}

// Independent researcher proposal update
export function emailProposalUpdate({ toEmail, toName, proposalTitle, status, feedback, link }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  const statusLabel = status === 'approved' ? 'approved' : status === 'rejected' ? 'not approved' : 'under review';
  return actionEmail({
    to: toEmail,
    subject: `Your proposal "${proposalTitle}" was ${statusLabel}`,
    heading: `Proposal ${statusLabel}`,
    intro: `Hi ${esc(first)},`,
    blocks: [
      `Your proposal <strong>${esc(proposalTitle)}</strong> has been ${statusLabel}.`,
      feedback ? `Feedback: ${esc(feedback)}` : '',
    ],
    button: link ? { label: 'View proposal', url: `${SITE}${link}` } : undefined,
    signoff: 'Best of luck,',
  });
}

// Competition/listing update
export function emailListingUpdate({ toEmail, toName, listingTitle, status, listingLink }) {
  const first = String(toName || 'there').split(/\s+/)[0];
  return actionEmail({
    to: toEmail,
    subject: `Update on your ${listingTitle} application`,
    heading: 'Application update',
    intro: `Hi ${esc(first)},`,
    blocks: [
      `There's an update regarding your application to <strong>${esc(listingTitle)}</strong>.`,
    ],
    button: { label: 'View details', url: `${SITE}${listingLink}` },
    signoff: 'Stay tuned,',
  });
}

// General notification helper - sends any notification type as email
export function sendNotificationEmail({ toEmail, toName, type, data }) {
  if (!toEmail) return { ok: false, reason: 'no email' };

  const templates = {
    comment: () => emailNewComment({ toEmail, toName, ...data }),
    project_invite: () => emailProjectInvite({ toEmail, toName, ...data }),
    application_update: () => emailApplicationUpdate({ toEmail, toName, ...data }),
    mentor_request: () => emailMentorRequest({ toEmail, toName, ...data }),
    announcement: () => emailAnnouncement({ toEmail, toName, ...data }),
    role_granted: () => emailRoleGranted({ toEmail, toName, ...data }),
    proposal_update: () => emailProposalUpdate({ toEmail, toName, ...data }),
    listing_update: () => emailListingUpdate({ toEmail, toName, ...data }),
  };

  const template = templates[type];
  if (!template) {
    console.warn(`[email] unknown notification type: ${type}`);
    return { ok: false, reason: 'unknown type' };
  }

  return template();
}
