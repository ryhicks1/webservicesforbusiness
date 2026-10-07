/**
 * Spam checks for the enquiry form.
 *
 * The time trap is an HMAC of the issue time. On Vercel the key is SMTP_PASS
 * (already set for mail). A token minted with the dev fallback below is
 * rejected once SMTP_PASS is set, so the value in this file cannot unlock
 * the live form.
 *
 * Blocked posts are not errors: the handler answers with the normal success
 * payload and does not send mail.
 */

'use strict';

var crypto = require('crypto');

var MIN_FILL_MS = 3000;
var MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
var DEV_KEY = 'wsfb-dev-token-key';

// http(s) and www. links, plus the bare hosts showing up in the phishing mail.
var LINK_RE = /https?:\/\/|www\.|(?:^|[^a-z0-9.])(?:[a-z0-9-]+\.)*sslip\.io(?:[^a-z0-9.]|$)|(?:^|[^a-z0-9.])(?:[a-z0-9-]+\.)*nip\.io(?:[^a-z0-9.]|$)|(?:^|[^a-z0-9.])(?:[a-z0-9-]+\.)+buzz(?:[^a-z0-9.]|$)/i;
var CYRILLIC_RE = /[\u0400-\u04FF]/;
var THROWAWAY_RE = /(?:^|[^a-z0-9.])(?:[a-z0-9-]+\.)*(?:smaqt\.com|nolettersbox\.com)(?:[^a-z0-9.]|$)/i;

var REASONS = {
  honeypot: true,
  'too-fast': true,
  token: true,
  expired: true,
  link: true,
  cyrillic: true,
  'disposable-email': true
};

function signingKey() {
  var pass = process.env.SMTP_PASS;
  if (pass != null) {
    var stripped = String(pass).replace(/\s+/g, '');
    if (stripped) return stripped;
  }
  return DEV_KEY;
}

function issueToken(now) {
  var issued = String(typeof now === 'number' ? now : Date.now());
  var sig = crypto.createHmac('sha256', signingKey()).update(issued).digest('hex');
  return issued + '.' + sig;
}

function checkToken(token, now) {
  var raw = String(token || '');
  var dot = raw.indexOf('.');
  if (dot < 10) return { ok: false, reason: 'token' };
  var issuedStr = raw.slice(0, dot);
  var sig = raw.slice(dot + 1);
  if (!/^\d{10,16}$/.test(issuedStr) || !/^[a-f0-9]{64}$/.test(sig)) {
    return { ok: false, reason: 'token' };
  }
  var expected = crypto.createHmac('sha256', signingKey()).update(issuedStr).digest('hex');
  var left = Buffer.from(sig);
  var right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { ok: false, reason: 'token' };
  }
  var age = now - Number(issuedStr);
  if (!isFinite(age) || age < 0) return { ok: false, reason: 'token' };
  if (age < MIN_FILL_MS) return { ok: false, reason: 'too-fast' };
  if (age > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  return { ok: true };
}

function matches(re, value) {
  re.lastIndex = 0;
  return re.test(value);
}

function checkContent(fields) {
  var keys = ['name', 'company', 'email', 'phone', 'need', 'message'];
  var i;
  var value;
  for (i = 0; i < keys.length; i++) {
    value = String(fields[keys[i]] == null ? '' : fields[keys[i]]);
    if (matches(LINK_RE, value)) return 'link';
  }
  for (i = 0; i < keys.length; i++) {
    value = String(fields[keys[i]] == null ? '' : fields[keys[i]]);
    if (matches(CYRILLIC_RE, value)) return 'cyrillic';
  }
  for (i = 0; i < keys.length; i++) {
    value = String(fields[keys[i]] == null ? '' : fields[keys[i]]);
    if (matches(THROWAWAY_RE, value)) return 'disposable-email';
  }
  return '';
}

function safeReason(reason) {
  return REASONS[reason] ? reason : 'spam';
}

module.exports = {
  MIN_FILL_MS: MIN_FILL_MS,
  MAX_AGE_MS: MAX_AGE_MS,
  issueToken: issueToken,
  checkToken: checkToken,
  checkContent: checkContent,
  safeReason: safeReason
};
