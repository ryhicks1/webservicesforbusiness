'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');
var handler = require('../api/site-check.js');

var PASS_HTML = [
  '<!doctype html><html><head>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Nguyen Plumbing</title>',
  '<meta name="description" content="Same-day plumbing. Call for a visit.">',
  '<script type="application/ld+json">',
  '{"@context":"https://schema.org","@graph":[{"@type":"Plumber","name":"Nguyen Plumbing","url":"https://maps.google.com/?q=Nguyen"}]}',
  '</script></head><body>',
  '<p>Call <a href="tel:+61412345678">0412 345 678</a></p>',
  '</body></html>'
].join('');

function psiBody(score, audits) {
  return {
    lighthouseResult: {
      categories: { performance: { score: score } },
      audits: audits || {
        viewport: { score: 1, scoreDisplayMode: 'binary' },
        'font-size': { score: 1, scoreDisplayMode: 'binary' }
      }
    }
  };
}

function depsFor(html, options) {
  var opts = options || {};
  var calls = [];
  var looked = [];
  return {
    calls: calls,
    looked: looked,
    lookup: function (host) {
      looked.push(host);
      if (opts.lookup) return opts.lookup(host);
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
    },
    request: function (target) {
      calls.push(target);
      if (opts.request) return opts.request(target);
      return Promise.resolve({
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html
      });
    },
    pagespeed: function (url) {
      if (opts.pagespeed) return opts.pagespeed(url);
      return Promise.resolve({ status: 200, json: psiBody(0.8) });
    }
  };
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader: function (k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status: function (c) { this.statusCode = c; return this; },
    json: function (o) { this.body = o; return this; }
  };
}

function invoke(body, opts) {
  var options = opts || {};
  var req = {
    method: options.method || 'POST',
    headers: Object.assign({ host: 'www.webservicesforbusiness.com' }, options.headers || {}),
    body: body,
    socket: { remoteAddress: options.ip || '203.0.113.40' }
  };
  var res = mockRes();
  return handler(req, res).then(function () { return res; });
}

function byId(items) {
  var map = {};
  items.forEach(function (item) { map[item.id] = item; });
  return map;
}

test('blocks private, loopback, link-local, and non-http targets', function () {
  [
    'http://127.0.0.1/',
    'http://127.0.0.1',
    'http://10.1.2.3/',
    'http://192.168.1.9/admin',
    'http://172.16.0.4/',
    'http://169.254.169.254/latest/meta-data',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://localhost/',
    'http://metadata.google.internal/',
    'http://printer.local/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0x7f000001/',
    'http://user:pass@example.com/',
    'https://example.com:8443/',
    'http://example.com:22/'
  ].forEach(function (input) {
    var result = handler.normaliseUrl(input);
    assert.equal(result.error, 'blocked', input);
    assert.equal(result.url, undefined);
  });
  ['file:///etc/passwd', 'javascript:alert(1)', 'not a url'].forEach(function (input) {
    var result = handler.normaliseUrl(input);
    assert.equal(result.error, 'invalid', input);
    assert.equal(result.url, undefined);
  });
  assert.equal(handler.isBlockedIp('8.8.8.8'), false);
  assert.equal(handler.isBlockedIp('93.184.216.34'), false);
  assert.equal(handler.isBlockedIp('1.1.1.1'), false);
  assert.equal(handler.isBlockedIp('2606:4700:4700::1111'), false);
});

test('accepts a bare domain and keeps the path', function () {
  var result = handler.normaliseUrl('Example.com/pricing');
  assert.equal(result.error, undefined);
  assert.equal(result.url.href, 'https://example.com/pricing');
});

test('rejects a blocked address before any DNS lookup', async function () {
  var deps = depsFor('');
  var result = await handler.runCheck('http://169.254.169.254/', deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'blocked');
  assert.equal(deps.looked.length, 0);
  assert.equal(deps.calls.length, 0);
});

test('refuses a public name that resolves to a private address', async function () {
  var deps = depsFor('', {
    lookup: function () {
      return Promise.resolve([
        { address: '1.1.1.1', family: 4 },
        { address: '10.0.0.5', family: 4 }
      ]);
    }
  });
  var result = await handler.runCheck('https://rebind.example/', deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'blocked');
  assert.equal(deps.calls.length, 0);
});

test('does not follow a redirect onto an internal address', async function () {
  var deps = depsFor('', {
    request: function () {
      return Promise.resolve({
        statusCode: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
        body: ''
      });
    }
  });
  var result = await handler.runCheck('https://example.com/', deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'blocked');
  assert.equal(deps.calls.length, 1);
  assert.equal(deps.calls[0].ip, '93.184.216.34');
});

test('scores a trades page and a PageSpeed result', async function () {
  var seen = [];
  var deps = depsFor(PASS_HTML, {
    pagespeed: function (url) {
      seen.push(url);
      return Promise.resolve({ status: 200, json: psiBody(0.82) });
    }
  });
  var result = await handler.runCheck('nguyen.example', deps);
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://nguyen.example/');
  assert.equal(seen[0], 'https://nguyen.example/');
  assert.deepEqual(result.items.map(function (item) { return item.id; }), [
    'tel', 'phone', 'mobile', 'speed', 'https', 'viewport', 'title', 'description', 'schema', 'maps'
  ]);
  var items = byId(result.items);
  Object.keys(items).forEach(function (id) {
    assert.equal(items[id].pass, true, id);
    assert.equal(items[id].line.indexOf('\n'), -1);
  });
  assert.match(items.speed.line, /82 out of 100/);
  assert.deepEqual(result.score, { pass: 10, total: 10 });
  assert.equal(deps.calls[0].ip, '93.184.216.34');
  assert.equal(deps.calls[0].hostname, 'nguyen.example');
});

test('fails the on-page rows with a one-line fix', function () {
  var items = byId(handler.analyseHtml(
    '<html><head><title> </title><meta name="description" content="">' +
    '<script type="application/ld+json">{"@type":"Organization","name":"X"}</script>' +
    '</head><body><p>Call +1 415 555 2671</p><a href="https://example.com/maps">Maps</a></body></html>',
    'http://example.com/'
  ));
  ['tel', 'phone', 'https', 'viewport', 'title', 'description', 'schema', 'maps'].forEach(function (id) {
    assert.equal(items[id].pass, false, id);
    assert.ok(items[id].line.length > 20, id);
    assert.equal(items[id].line.indexOf('\n'), -1);
  });
});

test('reads an Australian number and ignores an ABN-shaped string', function () {
  assert.equal(handler.hasAuPhone('Call 0412 345 678 today'), true);
  assert.equal(handler.hasAuPhone('0412345678'), true);
  assert.equal(handler.hasAuPhone('+61 412 345 678'), true);
  assert.equal(handler.hasAuPhone('+61412345678'), true);
  assert.equal(handler.hasAuPhone('+61 (0) 412 345 678'), true);
  assert.equal(handler.hasAuPhone('(02) 9876 5432'), true);
  assert.equal(handler.hasAuPhone('1300 555 010'), true);
  assert.equal(handler.hasAuPhone('1800 123 456'), true);
  assert.equal(handler.hasAuPhone('13 10 13'), true);
  assert.equal(handler.hasAuPhone('+61 450 914 150'), true);
  assert.equal(handler.hasAuPhone('ABN 43 762 178 040'), false);
  assert.equal(handler.hasAuPhone('+1 415 555 2671'), false);
  assert.equal(handler.hasAuPhone('04000000000'), false);
  assert.equal(handler.hasAuPhone('2026'), false);
});

test('accepts LocalBusiness subtypes and Google listing links', function () {
  var html = [
    '<html><head>',
    '<meta content="Emergency electrical work for homes." name="description">',
    '<title>Spark &amp; Co</title>',
    '<div itemtype="https://schema.org/Electrician"></div>',
    '<a href="https://maps.app.goo.gl/abc123">Map</a>',
    '<a href="https://g.page/sparkco">Profile</a>',
    '</head><body><a href="tel:0298765432">Call</a><img alt="Phone (02) 9876 5432"></body></html>'
  ].join('');
  var items = byId(handler.analyseHtml(html, 'https://spark.example/'));
  assert.equal(items.schema.pass, true);
  assert.equal(items.maps.pass, true);
  assert.equal(items.title.pass, true);
  assert.equal(items.description.pass, true);
  assert.equal(items.phone.pass, true);
  assert.equal(items.tel.pass, true);
  assert.equal(handler.isMapsHref('https://www.google.com/maps/place/Spark'), true);
  assert.equal(handler.isMapsHref('https://www.google.com.au/maps/place/Spark'), true);
  assert.equal(handler.isMapsHref('https://business.google.com/locations'), true);
  assert.equal(handler.isMapsHref('https://example.com/maps'), false);
  assert.equal(handler.isMapsHref('https://notgoogle.com/maps'), false);
  assert.equal(handler.isMapsHref('https://google.com.evil.com/maps'), false);
});

test('PageSpeed quota and outage leave those rows unchecked', function () {
  var quota = byId(handler.summarisePageSpeed(429, {
    error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' }
  }));
  assert.equal(quota.speed.pass, null);
  assert.equal(quota.mobile.pass, null);
  assert.match(quota.speed.line, /free limit/);
  var down = byId(handler.summarisePageSpeed(500, null));
  assert.equal(down.speed.pass, null);
  assert.equal(down.mobile.pass, null);

  var poor = byId(handler.summarisePageSpeed(200, psiBody(0.49, {
    viewport: { score: 1, scoreDisplayMode: 'binary' },
    'font-size': { score: 0.2, scoreDisplayMode: 'binary' }
  })));
  assert.equal(poor.speed.pass, false);
  assert.match(poor.speed.line, /49 out of 100/);
  assert.equal(poor.mobile.pass, false);

  var edge = byId(handler.summarisePageSpeed(200, psiBody(0.5, {
    viewport: { score: 1, scoreDisplayMode: 'binary' },
    'font-size': { score: 0.9, scoreDisplayMode: 'binary' },
    'target-size': { scoreDisplayMode: 'notApplicable', score: 0 }
  })));
  assert.equal(edge.speed.pass, true);
  assert.equal(edge.mobile.pass, true);
  assert.equal(handler.SPEED_PASS, 50);
});

test('a refused or missing page gets a plain message', async function () {
  var missing = await handler.runCheck('https://example.com/missing', depsFor('', {
    request: function () {
      return Promise.resolve({ statusCode: 404, headers: {}, body: 'missing' });
    }
  }));
  assert.equal(missing.ok, false);
  assert.equal(missing.message, 'That page was not found.');
  var refused = await handler.runCheck('https://example.com/', depsFor('', {
    request: function () {
      return Promise.resolve({ statusCode: 403, headers: { 'content-type': 'text/html' }, body: '<html></html>' });
    }
  }));
  assert.equal(refused.message, 'That site refused the check.');
});

test('a quota response is still a useful card', async function () {
  var deps = depsFor(PASS_HTML, {
    pagespeed: function () {
      return Promise.resolve({ status: 429, json: { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } } });
    }
  });
  var result = await handler.runCheck('https://nguyen.example/', deps);
  assert.equal(result.ok, true);
  assert.equal(result.score.total, 8);
  assert.equal(result.score.pass, 8);
  var items = byId(result.items);
  assert.equal(items.speed.pass, null);
  assert.equal(items.mobile.pass, null);
});

test('rate limit, method, and origin', async function () {
  handler.resetForTests();
  var ip = '198.51.100.77';
  var i;
  for (i = 0; i < handler.LIMIT; i++) {
    var allowed = await invoke({ url: 'http://127.0.0.1/' }, { ip: ip });
    assert.equal(allowed.statusCode, 400);
    assert.equal(allowed.body.ok, false);
  }
  var limited = await invoke({ url: 'https://example.com/' }, { ip: ip });
  assert.equal(limited.statusCode, 429);
  assert.match(limited.body.message, /Too many checks/);

  var get = await invoke({ url: 'https://example.com/' }, { method: 'GET', ip: '198.51.100.78' });
  assert.equal(get.statusCode, 405);

  var origin = await invoke({ url: 'https://example.com/' }, {
    ip: '198.51.100.79',
    headers: { host: 'www.webservicesforbusiness.com', origin: 'https://evil.example' }
  });
  assert.equal(origin.statusCode, 403);

  var empty = await invoke({}, { ip: '198.51.100.80' });
  assert.equal(empty.statusCode, 400);
  assert.match(empty.body.message, /website address/);
});

test('the page is static HTML with one h1, a FAQ, and no speed-test targeting', function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'website-check', 'index.html'), 'utf8');
  var visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  assert.equal((visible.match(/<h1\b/gi) || []).length, 1);
  assert.match(visible, /<h1[^>]*>\s*Tradie website checker\s*<\/h1>/);
  assert.match(visible, /Free website audit for tradies|free website audit for tradies/);
  assert.match(visible, /Is my website mobile friendly\?/);
  assert.match(visible, /What is a click to call check\?/);
  assert.match(visible, /Is this a free website audit for tradies\?/);
  assert.match(visible, /Fix it from \$350/);
  assert.match(html, /"@type": "FAQPage"/);
  assert.doesNotMatch(html, /website speed test/i);
  assert.match(html, /href="\/#contact"/);
  var root = path.join(__dirname, '..');
  var pages = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
      if (ent.name === 'node_modules' || ent.name === '.git') return;
      var full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.html')) pages.push(full);
    });
  })(root);
  var footers = 0;
  pages.forEach(function (file) {
    var text = fs.readFileSync(file, 'utf8');
    var at = text.indexOf('<footer class="ft">');
    if (at === -1) return;
    footers += 1;
    assert.match(text.slice(at), /href="\/website-check\/"/, file);
  });
  assert.ok(footers >= 10);
  var sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /https:\/\/www\.webservicesforbusiness\.com\/website-check\//);
});
