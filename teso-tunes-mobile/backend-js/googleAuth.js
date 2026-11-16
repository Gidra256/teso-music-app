import { OAuth2Client } from "google-auth-library";

const GOOGLE_WEB_CLIENT_ID = String(
  process.env.GOOGLE_WEB_CLIENT_ID ||
    "380021993741-6q5g850ds9qqu2u6c0q90rsucicj6l27.apps.googleusercontent.com",
).trim();

const verifier = new OAuth2Client(GOOGLE_WEB_CLIENT_ID);

export async function verifiedGoogleIdentity(credential) {
  if (typeof credential !== "string" || credential.length < 100 || credential.length > 10000) {
    const error = new Error("Google did not return a valid sign-in credential.");
    error.status = 400;
    throw error;
  }

  let payload;
  try {
    const ticket = await verifier.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_WEB_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    const error = new Error("Google sign-in verification failed. Please try again.");
    error.status = 401;
    throw error;
  }

  const sub = String(payload?.sub || "").trim();
  const email = String(payload?.email || "").trim().toLowerCase();
  const verified = payload?.email_verified === true || payload?.email_verified === "true";
  if (!sub || sub.length > 255 || !email || !verified || email.length > 320) {
    const error = new Error("A verified Google email address is required.");
    error.status = 403;
    throw error;
  }

  const name = String(payload?.name || payload?.given_name || email.split("@")[0] || "Listener")
    .trim().slice(0, 120) || "Listener";
  return { sub, email, name };
}

function googleAuthError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function attachDeviceEngagement(client, listenerId, deviceId) {
  if (!deviceId) return;
  await client.query(
    `update tesohub_music.song_likes likes
     set listener_id = $1
     where likes.device_id = $2
       and not exists (
         select 1 from tesohub_music.song_likes other
         where other.song_id = likes.song_id and other.listener_id = $1
       )`,
    [listenerId, deviceId],
  );
  await client.query(
    `update tesohub_music.artist_follows follows
     set listener_id = $1
     where follows.device_id = $2
       and not exists (
         select 1 from tesohub_music.artist_follows other
         where other.artist_id = follows.artist_id and other.listener_id = $1
       )`,
    [listenerId, deviceId],
  );
}

export async function googleSignIn({ persistence, identity, session, registrationEnabled }) {
  const client = await persistence.getAdminPool().connect();
  try {
    await client.query("BEGIN");
    // Serializes first-time sign-ins from the same Google identity.
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `tesohub-google:${identity.sub}`,
    ]);
    const linked = await client.query(
      `select listeners.id, listeners.status
       from tesohub_music.google_identities linked
       join tesohub_music.listeners listeners on listeners.id = linked.listener_id
       where linked.google_sub = $1
       for update of listeners`,
      [identity.sub],
    );

    let listenerId = linked.rows[0]?.id;
    let created = false;
    if (linked.rows[0]?.status === "suspended") {
      throw googleAuthError(403, "This TesoHub account is suspended.");
    }

    if (!listenerId) {
      if (!registrationEnabled) {
        throw googleAuthError(403, "New account registration is temporarily disabled.");
      }
      const existingEmail = await client.query(
        "select id from tesohub_music.listeners where lower(email) = $1 limit 1",
        [identity.email],
      );
      if (existingEmail.rowCount) {
        throw googleAuthError(
          409,
          "This email already has a TesoHub account. Log in with your password, then use Connect Google on your Profile to link it securely.",
        );
      }
      // Empty hash deliberately disables password login for Google-only accounts.
      const inserted = await client.query(
        `insert into tesohub_music.listeners
          (name, email, phone, password_hash, role, plan, status, created_at, updated_at)
         values ($1, $2, '', '', 'listener', 'free', 'active', now(), now())
         returning id`,
        [identity.name, identity.email],
      );
      listenerId = inserted.rows[0].id;
      await client.query(
        `insert into tesohub_music.google_identities
          (google_sub, listener_id, google_email)
         values ($1,$2,$3)`,
        [identity.sub, listenerId, identity.email],
      );
      created = true;
    }

    await attachDeviceEngagement(client, listenerId, session.deviceId);
    await client.query(
      `insert into tesohub_music.auth_tokens
        (id, listener_id, token_hash, device_id, device_name, created_at, last_active_at)
       values ($1,$2,$3,$4,$5,now(),now())`,
      [session.sessionId, listenerId, session.tokenHash, session.deviceId, session.deviceName],
    );
    const listener = await persistence.listenerProfile(listenerId, client);
    await client.query("COMMIT");
    return { listener, created };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw googleAuthError(409, "A TesoHub account already uses this email or Google identity.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function googleLinkAccount({ persistence, identity, listenerId }) {
  const client = await persistence.getAdminPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `tesohub-google:${identity.sub}`,
    ]);
    const listener = await client.query(
      "select id from tesohub_music.listeners where id = $1 and status = 'active' for update",
      [listenerId],
    );
    if (!listener.rowCount) throw googleAuthError(403, "This account is not available.");

    const other = await client.query(
      "select google_sub, listener_id from tesohub_music.google_identities where google_sub = $1 or listener_id = $2 for update",
      [identity.sub, listenerId],
    );
    const existing = other.rows.find((row) => row.google_sub === identity.sub && String(row.listener_id) === String(listenerId));
    if (existing) {
      await client.query("COMMIT");
      return { linked: true, already_linked: true };
    }
    if (other.rowCount) {
      throw googleAuthError(409, "This Google account is connected to another TesoHub account, or this TesoHub account already has a different Google account.");
    }

    await client.query(
      "insert into tesohub_music.google_identities (google_sub, listener_id, google_email) values ($1,$2,$3)",
      [identity.sub, listenerId, identity.email],
    );
    await client.query("COMMIT");
    return { linked: true, already_linked: false };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw googleAuthError(409, "This Google identity is already linked to an account.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function googleLinkStatus({ persistence, listenerId }) {
  const result = await persistence.getAdminPool().query(
    "select exists(select 1 from tesohub_music.google_identities where listener_id = $1) as linked",
    [listenerId],
  );
  return { linked: Boolean(result.rows[0]?.linked) };
}
