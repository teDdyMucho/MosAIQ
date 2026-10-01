#!/usr/bin/env node
//
// Generates assets/supabase-config.js from environment variables.
//
//   node build-config.js
//
// Values are read from, in order of precedence:
//   1. real environment variables  (SUPABASE_URL, SUPABASE_ANON_KEY)
//   2. a .env file next to this script
//
// Run it locally after editing .env, and as the build command on a host
// (Netlify/Vercel/Cloudflare Pages), where the variables come from the host's
// environment settings instead of a file.
//
// The generated file is a build artifact: it is gitignored, and overwritten on
// every run.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'assets', 'supabase-config.js');

// --- read .env (minimal parser; no dependency) ------------------------------
function readDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // strip matching surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const file = readDotEnv(path.join(ROOT, '.env'));
const url = (process.env.SUPABASE_URL || file.SUPABASE_URL || '').trim();
const anonKey = (process.env.SUPABASE_ANON_KEY || file.SUPABASE_ANON_KEY || '').trim();

// --- validate ---------------------------------------------------------------
const problems = [];

if (!url) {
  problems.push('SUPABASE_URL is empty.');
} else if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url.replace(/\/+$/, ''))) {
  // Self-hosted Supabase is legitimate, so warn rather than fail.
  console.warn('  warning: SUPABASE_URL does not look like a hosted Supabase URL:\n' +
               '           ' + url + '\n' +
               '           (fine if you self-host; check for a typo otherwise)');
}

if (!anonKey) {
  problems.push('SUPABASE_ANON_KEY is empty.');
} else {
  // Supabase keys are JWTs. Decode the payload and check the role claim --
  // shipping a service_role key to the browser would bypass every RLS policy.
  const parts = anonKey.split('.');
  if (parts.length !== 3) {
    problems.push('SUPABASE_ANON_KEY is not a JWT (expected three dot-separated parts).\n' +
                  '    Copy the "anon public" key from Settings -> API.');
  } else {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (claims.role === 'service_role') {
        problems.push('SUPABASE_ANON_KEY holds a SERVICE_ROLE key.\n' +
                      '    That key bypasses Row Level Security and must never reach the\n' +
                      '    browser. Use the "anon public" key from Settings -> API.');
      } else if (claims.role && claims.role !== 'anon') {
        console.warn('  warning: key role is "' + claims.role + '", expected "anon".');
      }
    } catch (e) {
      console.warn('  warning: could not decode the key payload; skipping the role check.');
    }
  }
}

if (problems.length) {
  console.error('\nbuild-config: cannot generate assets/supabase-config.js\n');
  for (const p of problems) console.error('  - ' + p);
  console.error('\n  Copy .env.example to .env and fill in both values, or set them as\n' +
                '  environment variables. See sql/README.md step 2.\n');
  process.exit(1);
}

// --- write ------------------------------------------------------------------
const banner = '// GENERATED FILE — do not edit.\n' +
               '// Produced by build-config.js from SUPABASE_URL / SUPABASE_ANON_KEY.\n' +
               '// Edit .env (or your host\'s environment variables) and re-run:\n' +
               '//   node build-config.js\n' +
               '//\n' +
               '// The anon key below is public by design and safe in the browser only\n' +
               '// because Row Level Security is enabled on every table.\n\n';

const body = 'window.RM_SUPABASE = ' +
  JSON.stringify({ url: url.replace(/\/+$/, ''), anonKey }, null, 2) + ';\n';

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + body);

const masked = anonKey.slice(0, 12) + '…' + anonKey.slice(-6);
console.log('build-config: wrote assets/supabase-config.js');
console.log('  url      ' + url);
console.log('  anonKey  ' + masked + '  (role: anon)');
