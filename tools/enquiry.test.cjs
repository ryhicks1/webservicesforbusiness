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
    hp_field: ''
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

test.beforeEach(function () {
  handler.resetForTests();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM;
});

test('accepts a real enquiry', function () {
  var result = handler.validateEnquiry(valid());
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
  assert.equal(result.value.email, 'alex@nguyenplumbing.com.au');
  var built = handler.buildEnquiry(result.value);
  assert.match(built.subject, /Enquiry — Website — Nguyen Plumbing/);
  assert.match(built.text, /Need a one-page site/);
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

test('honeypot is treated as success and is not emailed', async function () {
  var called = false;
  var original = global.fetch;
  global.fetch = function () { called = true; return Promise.resolve({ ok: true }); };
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    var res = await invoke(valid({ hp_field: 'http://spam.example' }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal(called, false);
  } finally {
    global.fetch = original;
  }
});

test('missing API key fails gracefully', async function () {
  var res = await invoke(valid());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'unavailable');
  assert.equal(res.body.ok, false);
});

test('sends to support@ with reply-to when the key is set', async function () {
  var captured;
  var original = global.fetch;
  global.fetch = function (url, opts) {
    captured = { url: url, opts: opts };
    return Promise.resolve({ ok: true, status: 200, text: async function () { return ''; } });
  };
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.RESEND_FROM = 'Web Services for Business <enquiries@webservicesforbusiness.com>';
  try {
    var res = await invoke(valid());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(captured.url, 'https://api.resend.com/emails');
    assert.equal(captured.opts.headers.Authorization, 'Bearer re_test_key');
    var payload = JSON.parse(captured.opts.body);
    assert.deepEqual(payload.to, ['support@webservicesforbusiness.com']);
    assert.equal(payload.reply_to, 'alex@nguyenplumbing.com.au');
    assert.equal(payload.from, 'Web Services for Business <enquiries@webservicesforbusiness.com>');
    assert.match(payload.text, /Alex Nguyen/);
    assert.equal(payload.text.indexOf('re_test_key'), -1);
  } finally {
    global.fetch = original;
  }
});

test('provider failure returns the delivery error', async function () {
  var original = global.fetch;
  global.fetch = function () {
    return Promise.resolve({
      ok: false,
      status: 422,
      text: async function () { return '{"message":"domain not verified"}'; }
    });
  };
  process.env.RESEND_API_KEY = 're_test_key';
  try {
    var res = await invoke(valid());
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, 'delivery');
  } finally {
    global.fetch = original;
  }
});

test('html form post without a key shows the phone and email fallback', async function () {
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

test('rate limit kicks in after repeated posts', async function () {
  process.env.RESEND_API_KEY = 're_test_key';
  var original = global.fetch;
  global.fetch = function () {
    return Promise.resolve({ ok: true, status: 200, text: async function () { return ''; } });
  };
  try {
    var last;
    for (var i = 0; i < 6; i++) last = await invoke(valid(), { ip: '198.51.100.8' });
    assert.equal(last.statusCode, 429);
    assert.equal(last.body.error, 'limited');
  } finally {
    global.fetch = original;
  }
});
