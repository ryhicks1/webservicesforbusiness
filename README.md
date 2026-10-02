# Web Services for Business — marketing site

Single-page static site for **webservicesforbusiness.com**. No build step, no
dependencies, no backend. Open `index.html` and it runs.

```
.
├── index.html              the deploy build — markup, CSS and JS inline
├── index.standalone.html   same page with fonts inlined; opens with no server
├── robots.txt              allows indexing — the site is live
├── fonts/                  Archivo + IBM Plex Mono (woff2, latin subset)
├── img/og.png              1200×630 social share card
├── img/work/               screenshots of the portfolio sites — SEE BELOW
└── tools/                  screenshot capture script
```

## Deploy

Vercel: import this repository, Framework Preset **Other**, and leave Root
Directory, build, install and output all empty — the site is served from the
repository root as-is. `/api/contact.js` is picked up as a Function without a
build step. Any static host can serve the pages; the form needs that Function
(or an equivalent) to deliver mail.

This site previously lived in `site/` inside `ryhicks1/scripttocast`. It was
split out with `git subtree split`, so the commit history came across intact.

## Indexing

The site is **live and indexable**: there is no robots meta tag, and `robots.txt`
allows crawling. Do not re-add a `noindex` tag or set `Disallow: /` — that would
pull a live site out of search results.

## Work screenshots — action needed

The Work cards expect five JPEGs in `img/work/`:

```
sakura.jpg  teacherchang.jpg  willcool.jpg  acting.jpg  castingbrief.jpg
```

**They are not committed.** The portfolio sites were unreachable from the build
environment, so each card currently falls back to a styled brand plate keyed to
that site's real colours. The page is not broken without them — it just gets
better with them.

To generate them, from the repository root:

```bash
npm i -D playwright
npx playwright install chromium
node tools/capture-screenshots.mjs
```

Then commit `img/work/` and redeploy. Each `<img>` carries `onerror="this.remove()"`,
so a missing or failed image reveals the plate underneath instead of a broken icon.

## Design

- **Type:** Archivo (400–800, headings and body) and IBM Plex Mono (labels,
  numerals). Self-hosted — no third-party request, no layout shift. ~65 KB total.
- **Colour:** near-black `#0C0D0F`, white text, and a single orange `#FF6B00`
  used only as micro-accent: the wordmark bar, hover states and focus rings.
  Deliberately sparing — do not expand it into headings or buttons.
- **Layout:** hairline grid, square corners, no shadows. Structure carries the
  design, not decoration.
- **Motion:** a 12px rise on scroll and nothing else. Off under
  `prefers-reduced-motion`.
- **Accessibility:** semantic landmarks, skip link, one `h1`, labelled fields,
  visible focus, `scroll-margin` so anchors clear the sticky header.

## Copy rules

- **Not personal.** No founder name, no first-person introduction, no "about me".
- **Not location-bound.** No city, region or country. It is a global services
  business.
- **No sole-trader framing.**
- **Terse.** Short sentences, concrete nouns. If a sentence only adds warmth,
  cut it.
- **Never label work as a demo, preview, mock or placeholder.** The cards state
  the sector and nothing about status.
- **No social profiles** and no surname anywhere. The ABN in the footer is
  intentional; note it is publicly searchable on ABN Lookup.

## Contact form

The homepage form posts to `/api/contact` (a Vercel Function). It checks the
name, email, and message, ignores a filled honeypot, and sends the enquiry to
support@webservicesforbusiness.com through [Resend](https://resend.com). The
button label is **Send** on the form, on the mobile jump link beside the
contact details, and on the mobile dock.

Mail is not delivered until `RESEND_API_KEY` is set. If the key is missing, or
Resend rejects the send, the page stays up and shows the phone and email
fallback. Nothing in the repository is a secret.

Set this on the Vercel project **webservicesforbusiness** → Settings →
Environment Variables, then redeploy:

| Variable | Required | Where to get it |
| --- | --- | --- |
| `RESEND_API_KEY` | Yes | [resend.com/api-keys](https://resend.com/api-keys) after creating a free account |
| `RESEND_FROM` | No | Verified sender. Default is `Web Services for Business <support@webservicesforbusiness.com>` |

Verify the domain at [resend.com/domains](https://resend.com/domains) and add
the DNS records Resend shows. Do not replace existing MX records.

See `.env.example`. Run `node --test tools/enquiry.test.cjs` to check the endpoint.
