'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var handler = require('../api/contact.js');

function valid(over) {
  return Object.assign({
    name: 'Alex Nguyen',
    company: 'Nguyen Plumbing',
    email: 'alex@nguyenplumbing.com.au',
    phone: '0450914150',
    need: 'Website',
    message: 'Need a one-page site for the business.',
    hp_field: '',
    form_token: handler.issueToken(Date.now() - 10000)
  }, over || {});
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: function (k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status: function (c) { this.statusCode = c; return this; },
    json: function (o) { this.body = o; return this; },
    send: function (b) { this.body = b; return this; }
  };
}

function invoke(body, opts) {
  var options = opts || {};
  var req = {
    method: options.method || 'POST',
    headers: Object.assign({ host: 'www.webservicesforbusiness.com' }, options.headers || {}),
    body: body,
    socket: { remoteAddress: options.ip || '203.0.113.10' }
  };
  var res = mockRes();
  return handler(req, res).then(function () { return res; });
}

var realTransport = handler.createTransport;

function useSmtp(sendMail) {
  process.env.SMTP_USER = 'ryan@webservicesforbusiness.com';
  process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
  var seen = { auth: null, message: null };
  handler.createTransport = function (auth) {
    seen.auth = auth;
    return {
      sendMail: function (message) {
        seen.message = message;
        return sendMail(message);
      }
    };
  };
  return seen;
}

test.beforeEach(function () {
  handler.resetForTests();
  handler.createTransport = realTransport;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

test('accepts a real enquiry', function () {
  var result = handler.validateEnquiry(valid());
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
  assert.equal(result.value.email, 'alex@nguyenplumbing.com.au');
  var built = handler.buildEnquiry(result.value);
  assert.equal(built.subject, 'WSFB enquiry from Alex Nguyen');
  assert.match(built.text, /Need a one-page site/);
  assert.deepEqual(handler.smtp, { host: 'smtp.gmail.com', port: 465, secure: true });
});

test('rejects obviously fake name, email, and message', function () {
  assert.equal(handler.validateEnquiry(valid({ name: 'a' })).field, 'name');
  assert.equal(handler.validateEnquiry(valid({ name: 'test' })).field, 'name');
  assert.equal(handler.validateEnquiry(valid({ name: '12345' })).field, 'name');
  assert.equal(handler.validateEnquiry(valid({ email: 'a@b' })).field, 'email');
  assert.equal(handler.validateEnquiry(valid({ email: 'nope' })).field, 'email');
  assert.equal(handler.validateEnquiry(valid({ email: 'a@b.c' })).field, 'email');
  assert.equal(handler.validateEnquiry(valid({ email: 'person@example.com' })).field, 'email');
  assert.equal(handler.validateEnquiry(valid({ email: 'person@test.com' })).field, 'email');
  assert.equal(handler.validateEnquiry(valid({ message: 'hi' })).field, 'message');
  assert.equal(handler.validateEnquiry(valid({ message: '12345678901' })).field, 'message');
  assert.equal(handler.validateEnquiry(valid({ message: '' })).field, 'message');
});

test('phone is optional and junk phone is rejected', function () {
  assert.equal(handler.validateEnquiry(valid({ phone: '' })).ok, true);
  assert.equal(handler.validateEnquiry(valid({ phone: 'abc' })).field, 'phone');
});

test('clean real enquiry passes the spam filter', function () {
  var result = handler.validateEnquiry(valid({
    name: 'Sam Patel',
    company: '',
    email: 'sam@pateljoinery.com.au',
    phone: '+61 450 914 150',
    need: 'Both',
    message: 'We need a simple site for the joinery business. Happy to talk this week about pages and photos.'
  }));
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
  assert.equal(result.reason, undefined);
  assert.equal(result.value.name, 'Sam Patel');
  assert.equal(result.value.phone, '+61 450 914 150');
  assert.match(result.value.message, /simple site/);
});

test('plain wording that is not a link still passes', function () {
  var result = handler.validateEnquiry(valid({
    message: 'The brief is a website, not a www rewrite, and https is fine once it is live. We want a bit more buzz in the shop.'
  }));
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
});

test('honeypot is treated as success and is not emailed', async function () {
  var seen = useSmtp(function () { throw new Error('should not send'); });
  var res = await invoke(valid({ hp_field: 'http://spam.example' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(seen.message, null);
});

test('missing SMTP settings fail gracefully', async function () {
  var res = await invoke(valid());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'unavailable');
  assert.equal(res.body.ok, false);
  process.env.SMTP_USER = 'ryan@webservicesforbusiness.com';
  var onlyUser = await invoke(valid(), { ip: '203.0.113.11' });
  assert.equal(onlyUser.statusCode, 503);
});

test('sends to ryan@ with reply-to when SMTP is set', async function () {
  var seen = useSmtp(function () { return Promise.resolve({ messageId: 'test' }); });
  var res = await invoke(valid());
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(seen.auth.user, 'ryan@webservicesforbusiness.com');
  assert.equal(seen.auth.pass, 'abcdefghijklmnop');
  assert.equal(seen.message.from, 'ryan@webservicesforbusiness.com');
  assert.equal(seen.message.to, 'ryan@webservicesforbusiness.com');
  assert.equal(seen.message.replyTo, 'alex@nguyenplumbing.com.au');
  assert.equal(seen.message.subject, 'WSFB enquiry from Alex Nguyen');
  assert.match(seen.message.text, /Alex Nguyen/);
  assert.equal(seen.message.text.indexOf('abcdefghijklmnop'), -1);
});

test('SMTP failure returns the delivery error', async function () {
  useSmtp(function () { return Promise.reject(new Error('Invalid login')); });
  var res = await invoke(valid());
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'delivery');
});

test('html form post without SMTP settings shows the phone and email fallback', async function () {
  var res = await invoke(valid(), { headers: { accept: 'text/html', host: 'localhost:3456' } });
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /That didn/);
  assert.match(res.body, /tel:\+61450914150/);
  assert.match(res.body, /support@webservicesforbusiness\.com/);
  assert.match(res.body, /noindex/);
});

test('strips line breaks so the subject stays one line', function () {
  var result = handler.validateEnquiry(valid({ company: 'Acme\r\nPlumbing' }));
  assert.equal(result.ok, true);
  var built = handler.buildEnquiry(result.value);
  assert.equal(built.subject, 'WSFB enquiry from Alex Nguyen');
  assert.equal(built.subject.indexOf('\n'), -1);
  assert.equal(built.subject.indexOf('\r'), -1);
  assert.equal(result.value.company, 'Acme Plumbing');
  assert.match(built.text, /Acme Plumbing/);
});

test('rejects a non-post', async function () {
  var res = await invoke(null, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

function spamResult(over, now) {
  return handler.validateEnquiry(valid(over), now);
}

test('time trap rejects a submit sooner than 3 seconds', function () {
  var now = 1700000000000;
  var fresh = handler.issueToken(now);
  var tooFast = spamResult({ form_token: fresh }, now + 2999);
  assert.equal(tooFast.ok, true);
  assert.equal(tooFast.spam, true);
  assert.equal(tooFast.reason, 'too-fast');

  var ready = spamResult({ form_token: fresh }, now + 3000);
  assert.equal(ready.ok, true);
  assert.equal(ready.spam, false);

  var missing = spamResult({ form_token: '' }, now + 10000);
  assert.equal(missing.reason, 'token');

  var forged = spamResult({ form_token: now + '.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, now + 10000);
  assert.equal(forged.reason, 'token');

  var stale = handler.issueToken(now - (15 * 24 * 60 * 60 * 1000));
  assert.equal(spamResult({ form_token: stale }, now).reason, 'expired');
});

test('dev-fallback token is rejected once SMTP_PASS is set', function () {
  var now = Date.now();
  var forged = handler.issueToken(now - 10000);
  process.env.SMTP_PASS = 'secret-app-password';
  var result = handler.validateEnquiry(valid({ form_token: forged }), now);
  assert.equal(result.spam, true);
  assert.equal(result.reason, 'token');
  delete process.env.SMTP_PASS;
});

test('rejects links, cyrillic, and throwaway sender domains', function () {
  assert.equal(spamResult({ message: 'Please pay via https://transfer.sslip.io/go today thanks' }).reason, 'link');
  assert.equal(spamResult({ message: 'See HTTPS://cash.example/pay for the transfer details' }).reason, 'link');
  assert.equal(spamResult({ name: 'Visit www.pay.example' }).reason, 'link');
  assert.equal(spamResult({ company: '10.1.2.3.sslip.io' }).reason, 'link');
  assert.equal(spamResult({ message: 'The host is foo.nip.io and that is the whole pitch here' }).reason, 'link');
  assert.equal(spamResult({ message: 'Open prize.buzz for the transfer instructions now' }).reason, 'link');
  assert.equal(spamResult({ message: 'Нужен перевод денег на карту сегодня пожалуйста' }).reason, 'cyrillic');
  assert.equal(spamResult({ name: 'Иван Петров' }).reason, 'cyrillic');
  assert.equal(spamResult({ email: 'bot@smaqt.com' }).reason, 'disposable-email');
  assert.equal(spamResult({ email: 'bot@nolettersbox.com' }).reason, 'disposable-email');
  assert.equal(spamResult({ email: 'bot@mail.smaqt.com' }).reason, 'disposable-email');
  assert.equal(spamResult({ message: 'Write me at spam@nolettersbox.com about the transfer today' }).reason, 'disposable-email');
});

test('blocked submissions look successful and are not emailed', async function () {
  var seen = useSmtp(function () { throw new Error('should not send'); });
  var logs = [];
  var orig = console.log;
  console.log = function (line) { logs.push(String(line)); };
  var now = Date.now();
  var cases = [
    { body: valid({ hp_field: 'http://spam.example' }), reason: 'honeypot', ip: '203.0.113.21' },
    { body: valid({ form_token: handler.issueToken(now) }), reason: 'too-fast', ip: '203.0.113.22' },
    { body: valid({ form_token: '' }), reason: 'token', ip: '203.0.113.23' },
    { body: valid({ message: 'Send the money via https://1.2.3.4.sslip.io/pay today' }), reason: 'link', ip: '203.0.113.24' },
    { body: valid({ message: 'Переведите деньги на эту карту сегодня пожалуйста' }), reason: 'cyrillic', ip: '203.0.113.25' },
    { body: valid({ email: 'jeolo@smaqt.com' }), reason: 'disposable-email', ip: '203.0.113.26' }
  ];
  try {
    for (var i = 0; i < cases.length; i++) {
      var item = cases[i];
      var res = await invoke(item.body, { ip: item.ip });
      assert.equal(res.statusCode, 200, item.reason);
      assert.deepEqual(res.body, { ok: true });
      assert.equal(logs[logs.length - 1], 'Enquiry blocked: ' + item.reason);
      assert.equal(logs[logs.length - 1].indexOf('sslip'), -1);
      assert.equal(logs[logs.length - 1].indexOf('203.0.113'), -1);
    }
    var html = await invoke(valid({ message: 'See www.phish.buzz for the cash transfer now' }), {
      ip: '203.0.113.27',
      headers: { accept: 'text/html', host: 'www.webservicesforbusiness.com' }
    });
    assert.equal(html.statusCode, 200);
    assert.match(html.body, /Sent\./);
    assert.equal(seen.message, null);
  } finally {
    console.log = orig;
  }
});

test('form token endpoint signs a token the enquiry handler accepts', async function () {
  var tokenHandler = require('../api/form-token.js');
  var req = { method: 'GET', headers: {} };
  var res = mockRes();
  tokenHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(typeof res.body.token, 'string');
  var issued = Number(res.body.token.split('.')[0]);
  var accepted = handler.validateEnquiry(valid({ form_token: res.body.token }), issued + 5000);
  assert.equal(accepted.spam, false);
  assert.equal(accepted.ok, true);
  var denied = mockRes();
  tokenHandler({ method: 'POST', headers: {} }, denied);
  assert.equal(denied.statusCode, 405);
});

test('rate limit kicks in after repeated posts', async function () {
  useSmtp(function () { return Promise.resolve({ messageId: 'test' }); });
  var last;
  for (var i = 0; i < 6; i++) last = await invoke(valid(), { ip: '198.51.100.8' });
  assert.equal(last.statusCode, 429);
  assert.equal(last.body.error, 'limited');
});
