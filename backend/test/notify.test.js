import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as notify from '../src/notify.js';
import * as store from '../src/store.js';

// --- Outbound webhook layer (Discord / WhatsApp relay) ---------------------
describe('notify — webhook fan-out', () => {
  afterEach(() => {
    notify.setWebhook('');
    notify.setWhatsapp('');
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('is a no-op (skipped) when no webhook URL is configured', async () => {
    notify.setWebhook('');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await notify.postDiscord({ content: 'hi' });
    expect(res).toEqual({ ok: false, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sendTest reports skipped without a webhook so the UI can prompt for one', async () => {
    notify.setWebhook('');
    expect(await notify.sendTest()).toEqual({ ok: false, skipped: true });
  });

  it('POSTs JSON to the configured Discord webhook', async () => {
    notify.setWebhook('https://discord.com/api/webhooks/1/abc');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 });
    const res = await notify.postDiscord({ content: 'hi' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://discord.com/api/webhooks/1/abc');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ content: 'hi' });
    expect(opts.signal).toBeInstanceOf(AbortSignal); // request is abortable (timeout)
  });

  it('never throws when the webhook call fails — returns an error result', async () => {
    notify.setWebhook('https://discord.com/api/webhooks/1/abc');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = await notify.postDiscord({ content: 'hi' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('network down');
  });

  it('reports a timeout (AbortError) as a clean error, not a throw', async () => {
    notify.setWebhook('https://discord.com/api/webhooks/1/abc');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const res = await notify.postDiscord({ content: 'hi' });
    expect(res).toEqual({ ok: false, error: 'timeout' });
  });

  it('notifyMove fires the webhook (fire-and-forget) without awaiting', async () => {
    notify.setWebhook('https://discord.com/api/webhooks/1/abc');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204 });
    notify.notifyMove({ title: 'Test paper', paperId: 'paper_9', category: 'Biology', label: 'Senior review', decision: 'move' });
    await Promise.resolve(); // let the microtask flush
    expect(fetchSpy).toHaveBeenCalled();
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).embeds[0].title).toMatch(/moved up/);
  });

  it('notifyEvent / notifyMove short-circuit with no channels configured (no fetch)', () => {
    notify.setWebhook('');
    notify.setWhatsapp('');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    notify.notifyEvent({ title: 'X', body: 'Y' });
    notify.notifyMove({ title: 'X', paperId: 'paper_1', decision: 'move' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// --- In-app delivery: pushNotif writes the bell row AND emits an SSE push ---
// This is the mechanism the bell relies on for near-real-time updates. We drive
// it through a real store mutation (a direct message) and assert both the
// persisted notification and the live 'notification' event reach the recipient.
describe('notify — in-app SSE delivery via store', () => {
  beforeEach(async () => { await store.reset(); });

  const jordan = () => store.authenticate('jordan@example.com', 'demo1234');
  const sam = () => store.authenticate('sam@example.com', 'demo1234');

  it('a new message pushes a bell notification to the recipient', () => {
    const from = sam();
    const to = jordan();
    const before = store.listNotifications(to.id).length;
    store.sendMessage({ from: from.id, to: to.id, text: 'Hey, saw your project!' });
    const after = store.listNotifications(to.id);
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ type: 'message', read: false, userId: to.id });
    expect(after[0].link).toBe(`/researcher/messages/${from.id}`);
  });

  it('emits a live SSE notification + message event to the recipient only', () => {
    const from = sam();
    const to = jordan();
    const events = [];
    const unsub = store.subscribeRealtime((targetId, type, data) => events.push({ targetId, type, data }));

    store.sendMessage({ from: from.id, to: to.id, text: 'Ping' });
    unsub();

    const forRecipient = events.filter((e) => e.targetId === to.id);
    expect(forRecipient.some((e) => e.type === 'notification')).toBe(true);
    expect(forRecipient.some((e) => e.type === 'message')).toBe(true);
    // The sender must not receive the recipient's notification.
    expect(events.some((e) => e.targetId === from.id && e.type === 'notification')).toBe(false);

    // After unsubscribing, no further events are delivered (clean teardown).
    const count = events.length;
    store.sendMessage({ from: from.id, to: to.id, text: 'Second' });
    expect(events.length).toBe(count);
  });

  it('marks notifications read by id and only for the owner', () => {
    const from = sam();
    const to = jordan();
    store.sendMessage({ from: from.id, to: to.id, text: 'Read me' });
    const note = store.listNotifications(to.id)[0];
    expect(note.read).toBe(false);

    // Another user can't mark someone else's notification read.
    store.markNotificationsRead(from.id, [note.id]);
    expect(store.listNotifications(to.id)[0].read).toBe(false);

    store.markNotificationsRead(to.id, [note.id]);
    expect(store.listNotifications(to.id)[0].read).toBe(true);
  });
});
