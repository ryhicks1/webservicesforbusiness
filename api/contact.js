/**
 * Enquiry endpoint for the marketing site.
 *
 * Vercel (project webservicesforbusiness) → Settings → Environment Variables:
 *   RESEND_API_KEY   required. Create one at https://resend.com/api-keys
 *   RESEND_FROM      optional. Verified sender. Default is
 *                    Web Services for Business <support@webservicesforbusiness.com>
 *
 * The domain must be verified in Resend (https://resend.com/domains) before
 * mail will deliver. Add only the records Resend shows. Do not replace the
 * MX records that already receive mail for support@.
 *
 * When RESEND_API_KEY is missing or Resend rejects the send, the handler
 * returns a failure the page turns into the phone and email fallback.
 * Nothing here is a secret. Do not hard-code an API key.
 */

'use strict';

var TO = 'support@webservicesforbusiness.com';
var DEFAULT_FROM = 'Web Services for Business <support@webservicesforbusiness.com>';
var NEEDS = { Website: true, AI: true, Both: true };
var NAME_BLOCK = {
  test: true, testing: true, asdf: true, asdfasdf: true, qwerty: true,
  fake: true, xxx: true, none: true, 'n/a': true, na: true, abc: true,
  foo: true, bar: true, anonymous: true, name: true, user: true, admin: true
};
var BAD_EMAIL_DOMAINS = {
  'example.com': true, 'example.org': true, 'example.net': true,
  'test.com': true, 'test.test': true, 'invalid.com': true,
  'fake.com': true, 'localhost': true
};
var EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

var hits = new Map();

function oneLine(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function messageText(value, max) {
  return String(value == null ? '' : value)
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, max);
}

function validateEnquiry(input) {
  var src = input && typeof input === 'object' ? input : {};
  var honeypot = oneLine(src.hp_field, 200);
  if (honeypot) return { ok: true, spam: true };

  var name = oneLine(src.name, 80);
  var company = oneLine(src.company, 120);
  var email = oneLine(src.email, 120).toLowerCase();
  var phone = oneLine(src.phone, 40);
  var need = oneLine(src.need, 20) || 'Website';
  var message = messageText(src.message, 4000);

  if (!/[a-z]{2,}/i.test(name) || NAME_BLOCK[name.toLowerCase()]) {
    return { ok: false, field: 'name', message: 'Add your name (at least two letters).' };
  }
  if (company.length > 120) {
    return { ok: false, field: 'company', message: 'Shorten the company name.' };
  }
  if (!EMAIL_RE.test(email)) {
    return { ok: false, field: 'email', message: 'Add a valid email so a reply can reach you.' };
  }
  var domain = email.split('@')[1] || '';
  if (BAD_EMAIL_DOMAINS[domain] || domain.endsWith('.invalid') || domain.endsWith('.test')) {
    return { ok: false, field: 'email', message: 'Add a valid email so a reply can reach you.' };
  }
  if (phone) {
    var digits = phone.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 20) {
      return { ok: false, field: 'phone', message: 'Add a phone number we can call, or leave it blank.' };
    }
  }
  if (!NEEDS[need]) {
    return { ok: false, field: 'need', message: 'Choose Website, AI, or Both.' };
  }
  if (message.length < 10 || !/[a-z]/i.test(message) || /^(.)\1+$/i.test(message.replace(/\s/g, ''))) {
    return { ok: false, field: 'message', message: 'Add a short message about what you need.' };
  }

  return {
    ok: true,
    spam: false,
    value: { name: name, company: company, email: email, phone: phone, need: need, message: message }
  };
}

function buildEnquiry(value) {
  var lines = [
    'Name: ' + value.name,
    value.company ? 'Company: ' + value.company : '',
    'Email: ' + value.email,
    value.phone ? 'Phone: ' + value.phone : '',
    'Requirement: ' + value.need,
    '',
    value.message
  ].filter(function (line) { return line !== ''; });
  var subject = 'Enquiry — ' + value.need + (value.company ? ' — ' + value.company : '');
  return {
    subject: subject.slice(0, 180),
    text: lines.join('\n')
  };
}

function clientIp(req) {
  var fwd = (req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '';
  var first = String(fwd).split(',')[0].trim();
  if (first) return first.slice(0, 80);
  var sock = req.socket && req.socket.remoteAddress;
  return sock ? String(sock) : 'unknown';
}

function limited(ip) {
  var now = Date.now();
  var windowMs = 10 * 60 * 1000;
  var list = (hits.get(ip) || []).filter(function (t) { return now - t < windowMs; });
  if (list.length >= 5) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

function originOk(req) {
  var headers = req.headers || {};
  var origin = headers.origin || headers.Origin || '';
  if (!origin) return true;
  var host = headers.host || headers.Host || '';
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch (err) {
    return false;
  }
}

function wantsHtml(req) {
  var accept = String((req.headers && (req.headers.accept || req.headers.Accept)) || '');
  if (accept.indexOf('application/json') !== -1) return false;
  return accept.indexOf('text/html') !== -1;
}

function parseBody(req) {
  var body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    var trimmed = body.trim();
    if (!trimmed) return {};
    if (trimmed.charAt(0) === '{') return JSON.parse(trimmed);
    return Object.fromEntries(new URLSearchParams(trimmed));
  }
  if (body && typeof body === 'object') return body;
  return {};
}

function page(title, heading, paragraphs) {
  var body = paragraphs.map(function (html) {
    return '<p>' + html + '</p>';
  }).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + title + '</title>' +
    '<link rel="stylesheet" href="/css/site.css">' +
    '</head><body><main class="wrap" style="padding:6rem 0 4rem;max-width:40rem">' +
    '<p class="mono eyebrow">Contact</p>' +
    '<h1 class="h-lg" style="margin-top:1rem">' + heading + '</h1>' +
    '<div class="prose" style="margin-top:1.25rem">' + body +
    '<p><a href="/#contact">Back to the site</a></p></div></main></body></html>';
}

var FALLBACK_HTML = 'Call <a href="tel:+61450914150">+61 450 914 150</a> or email <a href="mailto:support@webservicesforbusiness.com">support@webservicesforbusiness.com</a>.';

function send(res, code, payload, html) {
  res.status(code);
  res.setHeader('Cache-Control', 'no-store');
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(payload);
}

function fromAddress() {
  var configured = oneLine(process.env.RESEND_FROM || '', 200);
  return configured || DEFAULT_FROM;
}

async function deliver(value) {
  var key = process.env.RESEND_API_KEY;
  if (!key || !String(key).trim()) {
    var missing = new Error('RESEND_API_KEY is not set');
    missing.code = 'unavailable';
    throw missing;
  }
  var built = buildEnquiry(value);
  var response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + String(key).trim(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [TO],
      reply_to: value.email,
      subject: built.subject,
      text: built.text
    })
  });
  if (!response.ok) {
    var detail = '';
    try { detail = await response.text(); } catch (err) { detail = ''; }
    console.error('Resend rejected the enquiry', response.status, detail.slice(0, 500));
    var failed = new Error('Resend rejected the enquiry');
    failed.code = 'delivery';
    throw failed;
  }
}

async function handler(req, res) {
  var html = wantsHtml(req);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    if (html) {
      send(res, 405, null, page('Contact', 'Use the form.', [
        'This address only accepts the enquiry form.',
        FALLBACK_HTML
      ]));
      return;
    }
    send(res, 405, { ok: false, error: 'method' });
    return;
  }
  if (!originOk(req)) {
    if (html) {
      send(res, 403, null, page('Message not sent', "That didn't send.", [FALLBACK_HTML]));
      return;
    }
    send(res, 403, { ok: false, error: 'delivery' });
    return;
  }
  if (limited(clientIp(req))) {
    if (html) {
      send(res, 429, null, page('Message not sent', "That didn't send.", [
        'Too many messages from this network just now.',
        FALLBACK_HTML
      ]));
      return;
    }
    send(res, 429, { ok: false, error: 'limited' });
    return;
  }

  var body;
  try {
    body = parseBody(req);
  } catch (err) {
    body = null;
  }
  if (!body) {
    if (html) {
      send(res, 400, null, page('Message not sent', 'Check the form.', [
        'Add your name, a valid email, and a short message.',
        FALLBACK_HTML
      ]));
      return;
    }
    send(res, 400, { ok: false, error: 'invalid', field: 'message', message: 'Add a short message about what you need.' });
    return;
  }

  var result = validateEnquiry(body);
  if (!result.ok) {
    if (html) {
      send(res, 400, null, page('Message not sent', 'Check the form.', [result.message, FALLBACK_HTML]));
      return;
    }
    send(res, 400, { ok: false, error: 'invalid', field: result.field, message: result.message });
    return;
  }
  if (result.spam) {
    if (html) {
      send(res, 200, null, page('Message sent', 'Sent.', ['We reply within one business day.']));
      return;
    }
    send(res, 200, { ok: true });
    return;
  }

  try {
    await deliver(result.value);
  } catch (err) {
    var code = err && err.code === 'unavailable' ? 'unavailable' : 'delivery';
    if (code === 'unavailable') console.error('Enquiry not sent: RESEND_API_KEY is not set');
    else if (!(err && err.code === 'delivery')) console.error('Enquiry not sent', err && err.message);
    var status = code === 'unavailable' ? 503 : 502;
    if (html) {
      send(res, status, null, page('Message not sent', "That didn't send.", [
        'The form could not deliver just now.',
        FALLBACK_HTML
      ]));
      return;
    }
    send(res, status, { ok: false, error: code });
    return;
  }

  if (html) {
    send(res, 200, null, page('Message sent', 'Sent.', ['We reply within one business day.']));
    return;
  }
  send(res, 200, { ok: true });
}

handler.validateEnquiry = validateEnquiry;
handler.buildEnquiry = buildEnquiry;
handler.resetForTests = function () { hits.clear(); };

module.exports = handler;
