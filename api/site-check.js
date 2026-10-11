/**
 * Free website check for /website-check/.
 *
 * One POST { url } returns a pass/fail card. Google PageSpeed Insights API v5
 * (mobile) supplies the speed score and phone-layout audits. The key is
 * optional: set PAGESPEED_API_KEY on Vercel to raise the free quota. With no
 * key the call still goes out, and a quota or outage leaves those two rows
 * as "not checked" instead of failing the whole card.
 *
 * The rest is one fetch of the page HTML: tel: link, a visible Australian
 * phone number, viewport, HTTPS, title, meta description, LocalBusiness
 * schema, and a Google Maps or Business Profile link. There is no Places
 * lookup. The Google listing yes/no is asked in the browser.
 *
 * SSRF: http/https only, no credentials, ports 80 and 443 only. Hostnames
 * are resolved and refused if any address is private, link-local, loopback,
 * or otherwise non-public. Redirects are checked the same way, and the
 * connection is pinned to the address that was allowed.
 *
 * Rate limit matches the enquiry form's shape: 8 checks per 10 minutes per IP.
 */

'use strict';

var http = require('http');
var https = require('https');
var dns = require('dns');
var zlib = require('zlib');
var net = require('net');

var MAX_BYTES = 2 * 1024 * 1024;
var MAX_REDIRECTS = 4;
var HTML_TIMEOUT_MS = 12000;
var DNS_TIMEOUT_MS = 8000;
var PSI_TIMEOUT_MS = 40000;
var LIMIT = 8;
var WINDOW_MS = 10 * 60 * 1000;
var SPEED_PASS = 50;
var UA = 'Mozilla/5.0 (compatible; WSFBSiteCheck/1.0; +https://www.webservicesforbusiness.com/website-check/)';

var hits = new Map();

var v4Block = new net.BlockList();
v4Block.addSubnet('0.0.0.0', 8, 'ipv4');
v4Block.addSubnet('10.0.0.0', 8, 'ipv4');
v4Block.addSubnet('100.64.0.0', 10, 'ipv4');
v4Block.addSubnet('127.0.0.0', 8, 'ipv4');
v4Block.addSubnet('169.254.0.0', 16, 'ipv4');
v4Block.addSubnet('172.16.0.0', 12, 'ipv4');
v4Block.addSubnet('192.0.0.0', 24, 'ipv4');
v4Block.addSubnet('192.0.2.0', 24, 'ipv4');
v4Block.addSubnet('192.168.0.0', 16, 'ipv4');
v4Block.addSubnet('198.18.0.0', 15, 'ipv4');
v4Block.addSubnet('198.51.100.0', 24, 'ipv4');
v4Block.addSubnet('203.0.113.0', 24, 'ipv4');
v4Block.addSubnet('224.0.0.0', 4, 'ipv4');
v4Block.addAddress('255.255.255.255', 'ipv4');

var v6Block = new net.BlockList();
v6Block.addAddress('::', 'ipv6');
v6Block.addAddress('::1', 'ipv6');
v6Block.addSubnet('fc00::', 7, 'ipv6');
v6Block.addSubnet('fe80::', 10, 'ipv6');
v6Block.addSubnet('fec0::', 10, 'ipv6');
v6Block.addSubnet('ff00::', 8, 'ipv6');
v6Block.addSubnet('2001:db8::', 32, 'ipv6');
v6Block.addSubnet('2002::', 16, 'ipv6');
v6Block.addSubnet('64:ff9b::', 96, 'ipv6');
v6Block.addSubnet('64:ff9b:1::', 48, 'ipv6');

var LOCAL_TYPES = {
  localbusiness: 1, animalshelter: 1,
  automotivebusiness: 1, autobodyshop: 1, autodealer: 1, autopartsstore: 1,
  autorental: 1, autorepair: 1, autowash: 1, gasstation: 1,
  motorcycledealer: 1, motorcyclerepair: 1,
  childcare: 1, drycleaningorlaundry: 1,
  emergencyservice: 1, firestation: 1, hospital: 1, policestation: 1,
  employmentagency: 1,
  entertainmentbusiness: 1, adultentertainment: 1, amusementpark: 1,
  artgallery: 1, casino: 1, comedyclub: 1, movietheater: 1, nightclub: 1,
  financialservice: 1, accountingservice: 1, automatedteller: 1,
  bankorcreditunion: 1, insuranceagency: 1,
  foodestablishment: 1, bakery: 1, barorpub: 1, brewery: 1,
  cafeorcoffeeshop: 1, distillery: 1, fastfoodrestaurant: 1, icecreamshop: 1,
  restaurant: 1, winery: 1,
  governmentoffice: 1, postoffice: 1,
  healthandbeautybusiness: 1, beautysalon: 1, dayspa: 1, hairsalon: 1,
  healthclub: 1, nailsalon: 1, tattooparlor: 1,
  homeandconstructionbusiness: 1, electrician: 1, generalcontractor: 1,
  housepainter: 1, hvacbusiness: 1, locksmith: 1, movingcompany: 1,
  plumber: 1, roofingcontractor: 1,
  internetcafe: 1, legalservice: 1, attorney: 1, notary: 1, library: 1,
  lodgingbusiness: 1, bedandbreakfast: 1, campground: 1, hostel: 1,
  hotel: 1, motel: 1, resort: 1,
  medicalbusiness: 1, communityhealth: 1, dentist: 1, dermatology: 1,
  dietnutrition: 1, emergency: 1, geriatric: 1, gynecologic: 1,
  medicalclinic: 1, midwifery: 1, nursing: 1, obstetric: 1, oncologic: 1,
  optician: 1, optometric: 1, otolaryngologic: 1, pediatric: 1, pharmacy: 1,
  physician: 1, physiotherapy: 1, plasticsurgery: 1, podiatric: 1,
  primarycare: 1, psychiatric: 1, publichealth: 1,
  professionalservice: 1, radiostation: 1, realestateagent: 1,
  recyclingcenter: 1, selfstorage: 1, shoppingcenter: 1,
  sportsactivitylocation: 1, bowlingalley: 1, exercisegym: 1, golfcourse: 1,
  publicswimmingpool: 1, skiresort: 1, sportsclub: 1, stadiumorarena: 1,
  tenniscomplex: 1,
  store: 1, bikestore: 1, bookstore: 1, clothingstore: 1, computerstore: 1,
  conveniencestore: 1, departmentstore: 1, electronicsstore: 1, florist: 1,
  furniturestore: 1, gardenstore: 1, grocerystore: 1, hardwarestore: 1,
  hobbyshop: 1, homegoodsstore: 1, jewelrystore: 1, liquorstore: 1,
  mensclothingstore: 1, mobilephonestore: 1, movierentalstore: 1,
  musicstore: 1, officeequipmentstore: 1, outletstore: 1, pawnshop: 1,
  petstore: 1, shoestore: 1, sportinggoodsstore: 1, tireshop: 1, toystore: 1,
  wholesalestore: 1,
  televisionstation: 1, touristinformationcenter: 1, travelagency: 1
};

var ITEM_ORDER = ['tel', 'phone', 'mobile', 'speed', 'https', 'viewport', 'title', 'description', 'schema', 'maps'];

function fail(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

function ipv4FromMapped(ip) {
  var dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (dotted) return dotted[1];
  var hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return '';
  var hi = parseInt(hex[1], 16);
  var lo = parseInt(hex[2], 16);
  return ((hi >> 8) & 255) + '.' + (hi & 255) + '.' + ((lo >> 8) & 255) + '.' + (lo & 255);
}

function isBlockedIp(ip) {
  var raw = String(ip || '').trim().toLowerCase();
  if (!raw) return true;
  var mapped = ipv4FromMapped(raw);
  if (mapped) return isBlockedIp(mapped);
  var family = net.isIP(raw);
  try {
    if (family === 4) return v4Block.check(raw, 'ipv4');
    if (family === 6) return v6Block.check(raw, 'ipv6');
  } catch (err) {
    return true;
  }
  return true;
}

function hostProblem(host) {
  var h = String(host || '').toLowerCase();
  if (!h) return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localdomain')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata.google.com') return true;
  if (/^\d+$/.test(h) || /^0x[0-9a-f]+$/i.test(h)) return true;
  if (/^\d{1,3}(\.\d{1,3})+$/.test(h)) {
    var parts = h.split('.');
    if (parts.length !== 4) return true;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i].length > 1 && parts[i].charAt(0) === '0') return true;
      if (Number(parts[i]) > 255) return true;
    }
    return isBlockedIp(h);
  }
  if (!/^[a-z0-9.-]+$/.test(h)) return true;
  if (h.charAt(0) === '.' || h.charAt(h.length - 1) === '.' || h.indexOf('..') !== -1) return true;
  var labels = h.split('.');
  for (i = 0; i < labels.length; i++) {
    var label = labels[i];
    if (!label || label.length > 63) return true;
    if (label.charAt(0) === '-' || label.charAt(label.length - 1) === '-') return true;
  }
  return false;
}

function normaliseUrl(input) {
  var raw = String(input == null ? '' : input).trim();
  if (!raw || raw.length > 500 || /[\u0000-\u001F\s]/.test(raw)) {
    return { error: 'invalid', message: 'Enter a website address, like example.com.' };
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = 'https://' + raw;
  var url;
  try {
    url = new URL(raw);
  } catch (err) {
    return { error: 'invalid', message: 'Enter a website address, like example.com.' };
  }
  if (url.username || url.password) {
    return { error: 'blocked', message: 'That address cannot be checked.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'invalid', message: 'Enter a website address, like example.com.' };
  }
  if (url.protocol === 'https:' && url.port && url.port !== '443') {
    return { error: 'blocked', message: 'That address cannot be checked.' };
  }
  if (url.protocol === 'http:' && url.port && url.port !== '80') {
    return { error: 'blocked', message: 'That address cannot be checked.' };
  }
  var host = url.hostname.replace(/\.$/, '').toLowerCase();
  if (!host) return { error: 'blocked', message: 'That address cannot be checked.' };
  if (net.isIP(host)) {
    if (isBlockedIp(host)) return { error: 'blocked', message: 'That address cannot be checked.' };
  } else if (host.indexOf('.') === -1 || hostProblem(host)) {
    return { error: 'blocked', message: 'That address cannot be checked.' };
  }
  url.hostname = host;
  url.hash = '';
  return { url: url };
}

function withTimeout(promise, ms, code) {
  var timer;
  var timeout = new Promise(function (_, reject) {
    timer = setTimeout(function () {
      reject(fail(code, code));
    }, ms);
  });
  return Promise.race([promise, timeout]).then(function (value) {
    clearTimeout(timer);
    return value;
  }, function (err) {
    clearTimeout(timer);
    throw err;
  });
}

function defaultLookup(hostname) {
  return dns.promises.lookup(hostname, { all: true, verbatim: true });
}

function defaultRequest(target) {
  return new Promise(function (resolve, reject) {
    var lib = target.protocol === 'https:' ? https : http;
    var path = (target.pathname || '/') + (target.search || '');
    var settled = false;
    function done(err, value) {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value);
    }
    var opts = {
      hostname: target.ip,
      port: target.protocol === 'https:' ? 443 : 80,
      method: 'GET',
      path: path,
      family: target.family,
      servername: target.hostname,
      headers: {
        Host: target.hostname,
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'identity',
        'Accept-Language': 'en'
      },
      lookup: function (hostname, options, cb) {
        if (typeof options === 'function') cb = options;
        cb(null, target.ip, target.family);
      }
    };
    var req = lib.request(opts, function (res) {
      var chunks = [];
      var total = 0;
      res.on('data', function (chunk) {
        total += chunk.length;
        if (total > MAX_BYTES) {
          req.destroy();
          done(fail('toobig', 'toobig'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        var buf = Buffer.concat(chunks);
        var encoding = String(res.headers['content-encoding'] || '').toLowerCase();
        if ((buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) || encoding.indexOf('gzip') !== -1) {
          try { buf = zlib.gunzipSync(buf); } catch (err) { /* keep the bytes we have */ }
        }
        done(null, {
          statusCode: res.statusCode,
          headers: res.headers,
          body: buf.toString('utf8')
        });
      });
    });
    req.setTimeout(HTML_TIMEOUT_MS, function () {
      req.destroy();
      done(fail('timeout', 'timeout'));
    });
    req.on('error', function (err) {
      if (err && err.code === 'toobig') done(err);
      else if (err && err.code === 'timeout') done(fail('timeout', 'timeout'));
      else done(fail('network', 'network'));
    });
    req.end();
  });
}

async function defaultPageSpeed(pageUrl) {
  var endpoint = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  endpoint.searchParams.set('url', pageUrl);
  endpoint.searchParams.set('strategy', 'mobile');
  endpoint.searchParams.append('category', 'performance');
  endpoint.searchParams.append('category', 'seo');
  endpoint.searchParams.append('category', 'accessibility');
  var key = process.env.PAGESPEED_API_KEY;
  if (key != null && String(key).trim()) endpoint.searchParams.set('key', String(key).trim());
  var res = await fetch(endpoint, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) });
  var json = null;
  try { json = await res.json(); } catch (err) { json = null; }
  return { status: res.status, json: json };
}

async function resolveHost(hostname, lookup) {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw fail('blocked', 'blocked');
    return { address: hostname, family: net.isIP(hostname) };
  }
  var records;
  try {
    records = await withTimeout(Promise.resolve().then(function () {
      return lookup(hostname);
    }), DNS_TIMEOUT_MS, 'dns');
  } catch (err) {
    if (err && err.code === 'dns') throw err;
    throw fail('dns', 'dns');
  }
  if (!records || !records.length) throw fail('dns', 'dns');
  var i;
  for (i = 0; i < records.length; i++) {
    if (!records[i] || isBlockedIp(records[i].address)) throw fail('blocked', 'blocked');
  }
  return { address: records[0].address, family: records[0].family === 6 ? 6 : 4 };
}

function header(headers, name) {
  if (!headers) return '';
  var value = headers[name] || headers[name.toLowerCase()] || '';
  if (Array.isArray(value)) value = value[0];
  return String(value || '').split(',')[0].trim();
}

function isHtml(contentType, body) {
  var ct = String(contentType || '').toLowerCase();
  if (!ct) return /^\s*</.test(String(body || '').slice(0, 400));
  if (ct.indexOf('text/html') !== -1 || ct.indexOf('application/xhtml') !== -1) return true;
  return false;
}

async function fetchPublic(start, lookup, request, redirects, seen) {
  if (redirects > MAX_REDIRECTS) throw fail('network', 'network');
  var href = start.href;
  if (seen.has(href)) throw fail('network', 'network');
  seen.add(href);
  var resolved = await resolveHost(start.hostname, lookup);
  var response;
  try {
    response = await request({
      protocol: start.protocol,
      hostname: start.hostname,
      pathname: start.pathname || '/',
      search: start.search || '',
      ip: resolved.address,
      family: resolved.family
    });
  } catch (err) {
    if (err && (err.code === 'timeout' || err.code === 'toobig' || err.code === 'network')) throw err;
    throw fail('network', 'network');
  }
  var status = response && response.statusCode;
  if (status >= 300 && status < 400) {
    var location = header(response.headers, 'location');
    if (!location) throw fail('status', 'status');
    var next;
    try { next = new URL(location, start); } catch (err) { throw fail('blocked', 'blocked'); }
    var checked = normaliseUrl(next.href);
    if (checked.error) throw fail('blocked', 'blocked');
    return fetchPublic(checked.url, lookup, request, redirects + 1, seen);
  }
  if (status < 200 || status >= 300) {
    var err = fail('status', 'status');
    err.statusCode = status;
    throw err;
  }
  var body = String(response.body || '');
  if (!isHtml(header(response.headers, 'content-type'), body)) throw fail('nothtml', 'nothtml');
  return { finalUrl: start.href, body: body };
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) {
      var c = Number(n);
      return c > 0 && c < 65536 ? String.fromCharCode(c) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) {
      var c = parseInt(n, 16);
      return c > 0 && c < 65536 ? String.fromCharCode(c) : ' ';
    });
}

function stripNoise(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
}

function visibleText(html) {
  var source = stripNoise(html);
  var extras = [];
  var attr = /\b(?:alt|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  var match;
  while ((match = attr.exec(source))) extras.push(match[1] || match[2] || '');
  var text = source.replace(/<[^>]+>/g, ' ');
  return decodeEntities(text + ' ' + extras.join(' ')).replace(/\s+/g, ' ');
}

function hasAuPhone(text) {
  var re = /(?:^|[^\d])(?:(?:\+61|0061)[\s\-.]?\(?0?\)?[\s\-.]?\(?[2-478]\)?(?:[\s\-.]?\d){8}|0[\s\-.]?\(?[2-478]\)?(?:[\s\-.]?\d){8}|1[38]00(?:[\s\-.]?\d){6}|13[\s\-]\d{2}[\s\-]\d{2})(?!\d)/;
  return re.test(String(text || ''));
}

function attr(chunk, key) {
  var re = new RegExp('\\b' + key + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i');
  var match = re.exec(chunk || '');
  return match ? (match[1] || match[2] || match[3] || '') : '';
}

function hrefs(html) {
  var out = [];
  var re = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  var match;
  while ((match = re.exec(html))) out.push(decodeEntities(match[1] || match[2] || match[3] || ''));
  return out;
}

function hasTel(html) {
  var list = hrefs(html);
  var i;
  for (i = 0; i < list.length; i++) {
    var href = list[i].trim();
    if (!/^tel:/i.test(href)) continue;
    var digits = href.replace(/\D/g, '');
    if (digits.length >= 6 && digits.length <= 15) return true;
  }
  return false;
}

function googleHost(host) {
  return /(?:^|\.)google\.(?:com|co)\.[a-z]{2}$/.test(host) || /(?:^|\.)google\.[a-z]{2,3}$/.test(host);
}

function isMapsHref(value) {
  var raw = String(value || '').trim();
  if (!raw || /^\s*javascript:/i.test(raw)) return false;
  if (raw.slice(0, 2) === '//') raw = 'https:' + raw;
  var url;
  try { url = new URL(raw, 'https://example.invalid'); } catch (err) { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  var host = url.hostname.toLowerCase();
  var path = url.pathname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'g.page' || host.endsWith('.g.page')) return true;
  if (host === 'goo.gl' && path.indexOf('/maps') === 0) return true;
  if (host === 'business.google.com') return true;
  if (host.indexOf('maps.google.') === 0 && googleHost(host.slice(5))) return true;
  if (googleHost(host) && (path === '/maps' || path.indexOf('/maps/') === 0)) return true;
  return false;
}

function hasMapsLink(html, blocks) {
  var list = hrefs(html);
  var i;
  for (i = 0; i < list.length; i++) if (isMapsHref(list[i])) return true;
  for (i = 0; i < blocks.length; i++) {
    var found = false;
    walk(blocks[i].json, function (node) {
      if (!node || typeof node !== 'object') return;
      var keys = ['url', 'sameAs', '@id'];
      var k;
      for (k = 0; k < keys.length; k++) {
        var value = node[keys[k]];
        if (typeof value === 'string' && isMapsHref(value)) found = true;
        if (Array.isArray(value)) {
          var n;
          for (n = 0; n < value.length; n++) {
            if (typeof value[n] === 'string' && isMapsHref(value[n])) found = true;
          }
        }
      }
    });
    if (found) return true;
  }
  return false;
}

function jsonLdBlocks(html) {
  var out = [];
  var re = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  var match;
  while ((match = re.exec(html))) {
    var text = match[1].trim();
    if (!text) continue;
    try {
      out.push({ json: JSON.parse(text) });
    } catch (err) {
      out.push({ json: null, raw: text });
    }
  }
  return out;
}

function typeName(value) {
  var s = String(value || '').trim();
  var slash = s.lastIndexOf('/');
  if (slash !== -1) s = s.slice(slash + 1);
  var hash = s.lastIndexOf('#');
  if (hash !== -1) s = s.slice(hash + 1);
  var colon = s.lastIndexOf(':');
  if (colon !== -1) s = s.slice(colon + 1);
  return s.toLowerCase();
}

function walk(node, fn) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    var i;
    for (i = 0; i < node.length; i++) walk(node[i], fn);
    return;
  }
  fn(node);
  var keys = Object.keys(node);
  var k;
  for (k = 0; k < keys.length; k++) walk(node[keys[k]], fn);
}

function hasLocalBusiness(html, blocks) {
  var i;
  for (i = 0; i < blocks.length; i++) {
    var found = false;
    walk(blocks[i].json, function (node) {
      var t = node['@type'];
      var list = Array.isArray(t) ? t : (t ? [t] : []);
      var n;
      for (n = 0; n < list.length; n++) {
        if (typeof list[n] === 'string' && LOCAL_TYPES[typeName(list[n])]) found = true;
      }
    });
    if (found) return true;
    if (blocks[i].raw && /localbusiness/i.test(blocks[i].raw)) return true;
  }
  var micro = /\bitemtype\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  var match;
  while ((match = micro.exec(html))) {
    var parts = (match[1] || match[2] || '').split(/\s+/);
    var p;
    for (p = 0; p < parts.length; p++) {
      if (LOCAL_TYPES[typeName(parts[p])]) return true;
    }
  }
  return false;
}

function metaContent(html, name) {
  var re = /<meta\b([^>]*)>/gi;
  var match;
  while ((match = re.exec(html))) {
    var chunk = match[1];
    if (attr(chunk, 'name').toLowerCase() !== name) continue;
    var content = decodeEntities(attr(chunk, 'content')).replace(/\s+/g, ' ').trim();
    if (content) return content;
  }
  return '';
}

function pageTitle(html) {
  var match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return '';
  return decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
}

function hasViewport(html) {
  var re = /<meta\b([^>]*)>/gi;
  var match;
  while ((match = re.exec(html))) {
    if (attr(match[1], 'name').toLowerCase() !== 'viewport') continue;
    var content = attr(match[1], 'content').toLowerCase().replace(/\s+/g, '');
    if (content.indexOf('width=device-width') !== -1 || content.indexOf('initial-scale=') !== -1) return true;
  }
  return false;
}

function item(id, label, pass, line) {
  return { id: id, label: label, pass: pass, line: line };
}

function analyseHtml(html, finalUrl) {
  var source = String(html || '');
  var blocks = jsonLdBlocks(source);
  var text = visibleText(source);
  var secure = /^https:\/\//i.test(String(finalUrl || ''));
  var title = pageTitle(source);
  var description = metaContent(source, 'description');
  return [
    item('tel', 'Tap to call', hasTel(source),
      hasTel(source)
        ? 'A tap-to-call phone link is on the page.'
        : 'Add a tap-to-call link so a phone can dial in one tap.'),
    item('phone', 'Phone number on the page', hasAuPhone(text),
      hasAuPhone(text)
        ? 'An Australian phone number is visible on the page.'
        : 'Put an Australian phone number on the page where a customer can read it.'),
    item('https', 'Secure connection', secure,
      secure
        ? 'The address uses HTTPS.'
        : 'Switch the site to HTTPS so browsers do not warn people away.'),
    item('viewport', 'Mobile viewport', hasViewport(source),
      hasViewport(source)
        ? 'The page sets a mobile viewport.'
        : 'Add a viewport tag so the layout fits a phone screen.'),
    item('title', 'Page title', title.length > 0,
      title.length > 0
        ? 'The page has a title.'
        : 'Add a title that names the business and what it does.'),
    item('description', 'Meta description', description.length > 0,
      description.length > 0
        ? 'The page has a meta description.'
        : 'Add a short meta description that says what the business does.'),
    item('schema', 'Local business markup', hasLocalBusiness(source, blocks),
      hasLocalBusiness(source, blocks)
        ? 'The page includes LocalBusiness schema.'
        : 'Add LocalBusiness schema so search engines can read the name, phone, and area.'),
    item('maps', 'Google Maps link', hasMapsLink(source, blocks),
      hasMapsLink(source, blocks)
        ? 'The page links to Google Maps or the Business Profile.'
        : 'Add a link to the Google Maps listing or Business Profile.')
  ];
}

function auditFlag(audits, id) {
  var audit = audits && audits[id];
  if (!audit) return null;
  var mode = audit.scoreDisplayMode;
  if (mode === 'notApplicable' || mode === 'manual' || mode === 'informative') return null;
  if (typeof audit.score !== 'number') return null;
  return audit.score >= 0.9;
}

function psiUnavailable(speedLine, mobileLine) {
  return [
    item('speed', 'Phone loading speed', null, speedLine),
    item('mobile', 'Mobile friendliness', null, mobileLine)
  ];
}

function summarisePageSpeed(status, json) {
  var error = json && json.error;
  var quota = status === 429 || (error && (error.code === 429 || error.status === 'RESOURCE_EXHAUSTED'));
  if (quota) {
    return psiUnavailable(
      'Google\'s speed check is at its free limit right now. Try again later.',
      'Google\'s phone check is at its free limit right now. The viewport row still stands.'
    );
  }
  var result = json && json.lighthouseResult;
  if (!result || status < 200 || status >= 300) {
    return psiUnavailable(
      'Google\'s speed check did not answer. The other rows still stand.',
      'Google\'s phone check did not answer. The viewport row still stands.'
    );
  }
  var perf = result.categories && result.categories.performance;
  var raw = perf && typeof perf.score === 'number' ? perf.score : null;
  var speedItem;
  if (raw === null) {
    speedItem = item('speed', 'Phone loading speed', null,
      'Google could not score loading for this page. The other rows still stand.');
  } else {
    var score = Math.round(raw * 100);
    var pass = score >= SPEED_PASS;
    speedItem = item('speed', 'Phone loading speed', pass,
      pass
        ? 'Phone speed score is ' + score + ' out of 100.'
        : 'Phone speed score is ' + score + ' out of 100. Compress images and remove scripts the page does not need.');
  }
  var audits = result.audits || {};
  var ids = ['viewport', 'font-size', 'content-width', 'tap-targets', 'target-size'];
  var flags = [];
  var i;
  for (i = 0; i < ids.length; i++) {
    var flag = auditFlag(audits, ids[i]);
    if (flag !== null) flags.push(flag);
  }
  var mobileItem;
  if (!flags.length) {
    mobileItem = item('mobile', 'Mobile friendliness', null,
      'Google\'s phone check did not return a layout result. The viewport row still stands.');
  } else {
    var mobilePass = flags.every(Boolean);
    mobileItem = item('mobile', 'Mobile friendliness', mobilePass,
      mobilePass
        ? 'Text and layout fit a phone.'
        : 'The layout is awkward on a phone. Make the text readable and leave space around buttons.');
  }
  return [speedItem, mobileItem];
}

function scoreOf(items) {
  var scored = items.filter(function (row) { return row.pass === true || row.pass === false; });
  return {
    pass: scored.filter(function (row) { return row.pass === true; }).length,
    total: scored.length
  };
}

function messageFor(err) {
  var code = err && err.code ? err.code : err;
  if (code === 'invalid') return 'Enter a website address, like example.com.';
  if (code === 'blocked') return 'That address cannot be checked.';
  if (code === 'dns') return 'Could not find that site.';
  if (code === 'timeout') return 'That site took too long to answer.';
  if (code === 'toobig') return 'That page is too large to check.';
  if (code === 'nothtml') return 'That address did not return a web page.';
  if (code === 'status') {
    if (err && err.statusCode === 404) return 'That page was not found.';
    if (err && (err.statusCode === 401 || err.statusCode === 403)) return 'That site refused the check.';
    return 'That page returned an error.';
  }
  return 'Could not open that site.';
}

async function runCheck(rawUrl, overrides) {
  var parsed = normaliseUrl(rawUrl);
  if (parsed.error) return { ok: false, error: parsed.error, message: parsed.message };
  var d = overrides || {};
  var lookup = d.lookup || defaultLookup;
  var request = d.request || defaultRequest;
  var pagespeed = d.pagespeed || defaultPageSpeed;
  var psiPromise = Promise.resolve()
    .then(function () { return pagespeed(parsed.url.href); })
    .then(function (result) {
      return summarisePageSpeed(result && result.status, result && result.json);
    })
    .catch(function () {
      return summarisePageSpeed(0, null);
    });
  var page;
  try {
    page = await fetchPublic(parsed.url, lookup, request, 0, new Set());
  } catch (err) {
    return { ok: false, error: (err && err.code) || 'network', message: messageFor(err) };
  }
  var psiItems = await psiPromise;
  var byId = {};
  analyseHtml(page.body, page.finalUrl).concat(psiItems).forEach(function (row) {
    byId[row.id] = row;
  });
  var items = [];
  var i;
  for (i = 0; i < ITEM_ORDER.length; i++) {
    if (byId[ITEM_ORDER[i]]) items.push(byId[ITEM_ORDER[i]]);
  }
  return { ok: true, url: page.finalUrl, score: scoreOf(items), items: items };
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
  var list = (hits.get(ip) || []).filter(function (t) { return now - t < WINDOW_MS; });
  if (list.length >= LIMIT) {
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

function parseBody(req) {
  try {
    var body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') {
      var trimmed = body.trim();
      if (!trimmed) return {};
      if (trimmed.charAt(0) === '{') return JSON.parse(trimmed);
      return {};
    }
    if (body && typeof body === 'object') return body;
  } catch (err) {
    return null;
  }
  return {};
}

function send(res, code, payload) {
  res.status(code);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(payload);
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, { ok: false, error: 'method', message: 'Use the form on the website check page.' });
    return;
  }
  if (!originOk(req)) {
    send(res, 403, { ok: false, error: 'origin', message: 'Open the check from this site.' });
    return;
  }
  if (limited(clientIp(req))) {
    send(res, 429, { ok: false, error: 'limited', message: 'Too many checks from this network just now. Wait a few minutes.' });
    return;
  }
  var body = parseBody(req);
  if (!body || typeof body.url !== 'string') {
    send(res, 400, { ok: false, error: 'invalid', message: 'Enter a website address, like example.com.' });
    return;
  }
  try {
    var result = await runCheck(body.url);
    if (!result.ok) {
      var status = result.error === 'invalid' || result.error === 'blocked' ? 400 : 502;
      send(res, status, { ok: false, error: result.error, message: result.message });
      return;
    }
    send(res, 200, { ok: true, url: result.url, score: result.score, items: result.items });
  } catch (err) {
    console.error('Site check failed');
    send(res, 502, { ok: false, error: 'network', message: 'Could not check that site. Try again.' });
  }
}

handler.normaliseUrl = normaliseUrl;
handler.isBlockedIp = isBlockedIp;
handler.hasAuPhone = hasAuPhone;
handler.isMapsHref = isMapsHref;
handler.analyseHtml = analyseHtml;
handler.summarisePageSpeed = summarisePageSpeed;
handler.runCheck = runCheck;
handler.SPEED_PASS = SPEED_PASS;
handler.LIMIT = LIMIT;
handler.resetForTests = function () { hits.clear(); };

module.exports = handler;
