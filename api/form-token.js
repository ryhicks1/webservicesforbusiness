/**
 * Issues the signed timestamp the enquiry form must post back.
 * Cache-Control is no-store so a shared token is never reused across visitors.
 */

'use strict';

var guard = require('./enquiry-guard');

module.exports = function formToken(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'method' });
    return;
  }
  res.status(200).json({ ok: true, token: guard.issueToken(Date.now()) });
};
