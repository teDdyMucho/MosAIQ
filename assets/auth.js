// RavMizAI — authentication
//
// Talks to Supabase Auth when assets/supabase-config.js is filled in, and
// falls back to the original LocalStorage prototype when it is not, so the
// package still demos with no backend.
//
// Supabase owns the credentials: it hashes passwords (bcrypt), issues and
// refreshes JWT sessions, and sends the email confirmation. Nothing in this
// file ever stores or compares a password itself.

(function () {
  const cfg = window.RM_SUPABASE || {};
  const LIVE = Boolean(cfg.url && cfg.anonKey && window.supabase);

  let sb = null;
  if (LIVE) {
    sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  // --- shared helpers ------------------------------------------------------

  // Supabase surfaces real auth failures with messages that are fine to show,
  // but we normalise the common ones so we never leak whether an email exists.
  function friendly(err) {
    const m = String(err?.message || err || '').toLowerCase();
    if (m.includes('invalid login credentials')) return 'Email or password is incorrect.';
    if (m.includes('email not confirmed')) return 'Please verify your email before signing in.';
    if (m.includes('user already registered') || m.includes('already been registered'))
      return 'An account with that email already exists. Try signing in instead.';
    if (m.includes('token has expired') || m.includes('expired'))
      return 'That code has expired. Request a new one below.';
    if (m.includes('invalid') && m.includes('token')) return 'That code is not correct.';
    if (m.includes('rate limit') || m.includes('too many'))
      return 'Too many attempts. Please wait a moment and try again.';
    if (m.includes('password')) return 'Password must be at least 10 characters.';
    if (m.includes('failed to fetch') || m.includes('networkerror'))
      return 'Could not reach the server. Check your connection and try again.';
    return err?.message || 'Something went wrong. Please try again.';
  }

  // Password policy, enforced client-side for fast feedback. Supabase enforces
  // its own minimum server-side; set the project minimum to 10 to match.
  function passwordProblem(pw) {
    if (!pw || pw.length < 10) return 'Password must be at least 10 characters.';
    if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
    if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
    if (!/[0-9]/.test(pw)) return 'Password must include a number.';
    if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character.';
    return null;
  }

  // --- LocalStorage fallback (original prototype behaviour) ----------------

  const proto = {
    read() { try { return JSON.parse(localStorage.getItem('rm_user') || 'null'); } catch (e) { return null; } },
    write(u) { localStorage.setItem('rm_user', JSON.stringify(u)); },

    async signUp({ first, last, email, password }) {
      proto.write({
        first, last, email, password,
        verified: false, member: false, createdAt: Date.now()
      });
      localStorage.setItem('rm_verify_code', '111111');
      localStorage.setItem('rm_verify_email', email);
      return { needsVerification: true };
    },

    async signIn({ email, password }) {
      const u = proto.read();
      if (!u || String(u.email).toLowerCase() !== String(email).toLowerCase() || u.password !== password) {
        throw new Error('Invalid login credentials');
      }
      if (!u.verified) {
        localStorage.setItem('rm_verify_email', u.email);
        return { needsVerification: true };
      }
      return { needsVerification: false };
    },

    async verify({ code }) {
      if (code !== localStorage.getItem('rm_verify_code')) {
        throw new Error('Invalid token: that code is not correct. For this prototype, use 111111.');
      }
      const u = proto.read();
      if (u) { u.verified = true; proto.write(u); }
      return true;
    },

    async resend() { localStorage.setItem('rm_verify_code', '111111'); return true; },
    async signOut() { localStorage.removeItem('rm_user'); return true; },

    // Offline mirror of activateTrial(): grants the 7-day trial locally so the
    // funnel still demos without a backend. No money is involved either way.
    async activateTrial() {
      const u = proto.read() || {};
      if (u.trialUsed) throw new Error('You have already used your free trial.');
      const ends = Date.now() + 7 * 24 * 60 * 60 * 1000;
      Object.assign(u, { member: true, trialUsed: true, trialStart: Date.now(), trialEnds: ends, minutes: 60, chats: 120 });
      proto.write(u);
      return { ok: true, trial_ends: new Date(ends).toISOString() };
    },

    // Offline stand-in for Stripe Checkout. There is no hosted page to send
    // anyone to, so grant the demo trial and stay on the site.
    async startCheckout() {
      await proto.activateTrial();
      return null;   // null means "no redirect; already handled"
    },

    // Offline mirror of the live check. `member` is set by the prototype
    // payment step, so the trial funnel still demos end to end.
    async isSubscribed() {
      const u = proto.read();
      if (!u || !u.verified) return false;
      if (u.trialEnds && Date.now() > u.trialEnds) return false;
      return Boolean(u.member);
    },
    async profile() {
      const u = proto.read();
      return u ? { first_name: u.first, last_name: u.last, is_member: Boolean(u.member) } : null;
    },
    async currentUser() {
      const u = proto.read();
      return u && u.verified ? { email: u.email, firstName: u.first, lastName: u.last } : null;
    }
  };

  // --- Supabase implementation --------------------------------------------

  const live = {
    async signUp({ first, last, email, password }) {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: {
          // Read by the handle_new_user() trigger to populate public.profiles.
          data: { first_name: first, last_name: last },
          emailRedirectTo: new URL('verify.html', location.href).href
        }
      });
      if (error) throw error;

      localStorage.setItem('rm_verify_email', email);

      // With "Confirm email" on, Supabase returns a user with no session until
      // the code is entered. identities === [] means the email was already
      // registered (Supabase does not reveal this via an error, by design).
      const alreadyRegistered = data?.user && Array.isArray(data.user.identities)
        && data.user.identities.length === 0;
      if (alreadyRegistered) throw new Error('User already registered');

      return { needsVerification: !data?.session };
    },

    async signIn({ email, password }) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        // An unconfirmed account should be routed to verification, not shown
        // a dead end.
        if (String(error.message || '').toLowerCase().includes('email not confirmed')) {
          localStorage.setItem('rm_verify_email', email);
          return { needsVerification: true };
        }
        throw error;
      }
      return { needsVerification: !data?.session };
    },

    // Supabase sends a 6-digit OTP for signup confirmation; verifyOtp exchanges
    // it for a real session.
    async verify({ code, email }) {
      const target = email || localStorage.getItem('rm_verify_email');
      if (!target) throw new Error('We lost track of your email. Please sign in again.');
      const { data, error } = await sb.auth.verifyOtp({
        email: target, token: code, type: 'email'
      });
      if (error) throw error;
      if (!data?.session) throw new Error('Verification did not return a session. Please sign in.');
      return true;
    },

    async resend({ email } = {}) {
      const target = email || localStorage.getItem('rm_verify_email');
      if (!target) throw new Error('We lost track of your email. Please sign up again.');
      const { error } = await sb.auth.resend({
        type: 'signup',
        email: target,
        options: { emailRedirectTo: new URL('verify.html', location.href).href }
      });
      if (error) throw error;
      return true;
    },

    async signOut() {
      await sb.auth.signOut();
      localStorage.removeItem('rm_user');
      return true;
    },

    async currentUser() {
      let { data } = await sb.auth.getSession();
      let s = data?.session;

      // getSession() returns the stored session without contacting the server,
      // and an access token lives about an hour. Once it has expired this comes
      // back null even though the refresh token is still good — which looked
      // like being signed out on every page change. Refresh before giving up.
      if (!s?.user) {
        const { data: refreshed, error } = await sb.auth.refreshSession();
        if (error || !refreshed?.session?.user) return null;
        s = refreshed.session;
      } else if (s.expires_at && s.expires_at * 1000 < Date.now() + 60000) {
        // Expires within the minute: renew now so the page does not fall over
        // mid-navigation.
        const { data: refreshed } = await sb.auth.refreshSession();
        if (refreshed?.session?.user) s = refreshed.session;
      }

      const meta = s.user.user_metadata || {};
      return {
        id: s.user.id,
        email: s.user.email,
        firstName: meta.first_name || 'Member',
        lastName: meta.last_name || ''
      };
    },

    // Profile row, for the member pages. Returns null rather than throwing so a
    // transient read failure never blocks rendering.
    async profile() {
      const { data: sess } = await sb.auth.getSession();
      const uid = sess?.session?.user?.id;
      if (!uid) return null;
      const { data, error } = await sb
        .from('profiles')
        .select('first_name,last_name,call_me,is_member,subscribed_at,subscribed_until,subscription_note')
        .eq('id', uid)
        .maybeSingle();
      if (error) { console.warn('[RavMizAI] profile read failed:', error.message); return null; }
      return data;
    },

    // Starts Stripe Checkout and returns the hosted URL to redirect to.
    // Price and trial length are set server-side, so nothing here can change
    // what the visitor is charged.
    async startCheckout() {
      const { data: sess } = await sb.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const res = await fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/create-checkout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': cfg.anonKey,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });

      let body = null;
      try { body = await res.json(); } catch (e) { /* non-JSON error page */ }

      if (res.status === 404) {
        throw new Error('Billing is not available yet. Please contact support.');
      }
      if (!res.ok || !body?.ok || !body?.url) {
        throw new Error(body?.message || body?.error || 'Could not start checkout. Please try again.');
      }
      return body.url;
    },

    // Activates the one-time 7-day trial through the activate-trial Edge
    // Function. The browser cannot write membership itself (RLS blocks it), so
    // the grant happens server-side with the service-role key.
    async activateTrial() {
      const { data: sess } = await sb.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const res = await fetch(cfg.url.replace(/\/+$/, '') + '/functions/v1/activate-trial', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'apikey': cfg.anonKey,
          'Content-Type': 'application/json'
        },
        body: '{}'
      });

      let body = null;
      try { body = await res.json(); } catch (e) { /* non-JSON error page */ }

      if (!res.ok || !body?.ok) {
        // 404 means the function was never deployed; say so plainly rather
        // than showing a generic failure.
        if (res.status === 404) {
          throw new Error('Trial activation is not available yet. Please contact support.');
        }
        throw new Error(body?.message || 'Could not activate the trial. Please try again.');
      }
      return body;
    },

    // Membership check, used to gate Call / Text.
    //
    // Asks the database function so the rule has one definition. Falls back to
    // reading the profile row if the function is missing (002 not yet run).
    //
    // Returns false when the answer cannot be determined: an unreachable
    // backend must not hand out access.
    async isSubscribed() {
      const { data: sess } = await sb.auth.getSession();
      if (!sess?.session) return false;
      const { data, error } = await sb.rpc('is_subscribed');
      if (!error) return data === true;
      console.warn('[RavMizAI] is_subscribed() unavailable, reading profile:', error.message);
      const p = await live.profile();
      if (!p) return false;
      const until = p.subscribed_until ? new Date(p.subscribed_until) : null;
      return Boolean(p.is_member) && (!until || until > new Date());
    }
  };

  // Data left by the LocalStorage prototype must not outlive it. Once a real
  // backend is configured, an old `rm_user` makes the public pages believe
  // someone is signed in while the member pages (which ask Supabase) send them
  // to the login screen — the two disagree and the visitor looks logged out on
  // every page change. Clear it unless a real session exists.
  if (LIVE) {
    (async () => {
      try {
        const { data } = await sb.auth.getSession();
        if (data?.session?.user) return;              // genuine session, leave it
        const { data: r } = await sb.auth.refreshSession();
        if (r?.session?.user) return;                 // recoverable, leave it
        if (localStorage.getItem('rm_user')) {
          console.warn('[RavMizAI] clearing stale prototype session data.');
          ['rm_user', 'rm_verify_code', 'rm_verify_email', 'rm_next_after_verify']
            .forEach(k => localStorage.removeItem(k));
        }
      } catch (e) { /* storage unavailable; nothing to clean */ }
    })();
  }

  const impl = LIVE ? live : proto;

  window.RMAuth = {
    isLive: LIVE,
    passwordProblem,
    friendly,
    signUp: impl.signUp,
    signIn: impl.signIn,
    verify: impl.verify,
    resend: impl.resend,
    signOut: impl.signOut,
    currentUser: impl.currentUser,
    profile: impl.profile || (async () => null),
    isSubscribed: impl.isSubscribed,
    startCheckout: impl.startCheckout,
    activateTrial: impl.activateTrial,

    // Gate for Call / Text. Sends a non-subscriber to the subscription page
    // instead of letting them through. Returns true when access is allowed.
    async requireSubscription(redirect = 'subscribe.html') {
      if (await impl.isSubscribed()) return true;
      location.href = redirect;
      return false;
    },

    // Mirrors the signed-in user into the shape the existing member pages read,
    // so app/*.html keep working unchanged.
    async syncLegacyUser() {
      const u = await impl.currentUser();
      if (!u) return null;
      const prev = (() => { try { return JSON.parse(localStorage.getItem('rm_user') || '{}'); } catch (e) { return {}; } })();
      const merged = Object.assign({}, prev, {
        first: u.firstName, last: u.lastName, email: u.email, verified: true
      });
      // Under live auth Supabase holds the credential, so no password belongs in
      // storage. In offline fallback mode it is the only credential store, so
      // removing it here would make the next sign-in impossible.
      if (LIVE) delete merged.password;
      localStorage.setItem('rm_user', JSON.stringify(merged));
      return u;
    }
  };
})();
