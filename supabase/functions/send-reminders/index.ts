// Sends whatever reminders are due, then marks them sent.
//
// Deliberately dumb: the app has already worked out the exact instant each
// reminder should fire (including for repeating events) and written it to the
// `reminders` table. This only ever asks "what is due now?".
//
// Deploy:   supabase functions deploy send-reminders --no-verify-jwt
// Schedule: see the cron job in the setup SQL — it calls this every minute.
//
// Secrets it expects (set with `supabase secrets set NAME=value`):
//   VAPID_PUBLIC_KEY    the same key the app holds
//   VAPID_PRIVATE_KEY   kept only here
//   VAPID_SUBJECT       "mailto:you@example.com"
//   CRON_SECRET         any long random string, also sent by the cron job
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:reminders@example.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const BATCH = 200;

type Reminder = {
  user_id: string;
  id: string;
  title: string;
  body: string;
  url: string | null;
};

type Subscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function rest(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

Deno.serve(async (req: Request) => {
  // Deployed with --no-verify-jwt so cron can reach it, so the shared secret
  // is what stops anyone else triggering a send.
  if (CRON_SECRET && req.headers.get("x-cron-key") !== CRON_SECRET) {
    return new Response("no", { status: 401 });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response("VAPID keys are not set", { status: 500 });
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const now = new Date().toISOString();
  const due = await json<Reminder[]>(
    await rest(
      `reminders?select=user_id,id,title,body,url` +
        `&sent_at=is.null&fire_at=lte.${encodeURIComponent(now)}` +
        `&order=fire_at.asc&limit=${BATCH}`,
    ),
    "loading reminders",
  );

  if (!due?.length) {
    return Response.json({ due: 0, sent: 0 });
  }

  // One lookup per user rather than per reminder.
  const userIds = [...new Set(due.map((row) => row.user_id))];
  const subscriptions = await json<(Subscription & { user_id: string })[]>(
    await rest(
      `push_subscriptions?select=user_id,endpoint,p256dh,auth` +
        `&user_id=in.(${userIds.map((id) => `"${id}"`).join(",")})`,
    ),
    "loading subscriptions",
  );

  const byUser = new Map<string, Subscription[]>();
  for (const row of subscriptions ?? []) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }

  const sent: Reminder[] = [];
  const gone: string[] = [];

  for (const reminder of due) {
    const targets = byUser.get(reminder.user_id) ?? [];
    const payload = JSON.stringify({
      title: reminder.title,
      body: reminder.body,
      url: reminder.url ?? "./",
      tag: reminder.id,
    });

    // A user with no devices still counts as handled — otherwise the row
    // would be retried every minute forever.
    let delivered = targets.length === 0;

    for (const target of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          payload,
        );
        delivered = true;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410 mean the browser threw the subscription away.
        if (status === 404 || status === 410) gone.push(target.endpoint);
        else console.error("push failed", status, String(error));
      }
    }

    if (delivered) sent.push(reminder);
  }

  if (sent.length) {
    const stamp = new Date().toISOString();
    // Scoped per user: reminder ids are only unique within a user, and an
    // upsert here could insert a half-empty row if one had been deleted
    // between the read and the write.
    const byOwner = new Map<string, string[]>();
    for (const row of sent) {
      const list = byOwner.get(row.user_id) ?? [];
      list.push(row.id);
      byOwner.set(row.user_id, list);
    }
    for (const [owner, ids] of byOwner) {
      await rest(
        `reminders?user_id=eq.${owner}&id=in.(${ids.map((id) => `"${id}"`).join(",")})`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ sent_at: stamp }),
        },
      );
    }
  }

  if (gone.length) {
    await rest(
      `push_subscriptions?endpoint=in.(${gone.map((e) => `"${e}"`).join(",")})`,
      { method: "DELETE" },
    );
  }

  return Response.json({ due: due.length, sent: sent.length, dropped: gone.length });
});
