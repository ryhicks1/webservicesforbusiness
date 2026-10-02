# Web Services for Business — marketing site

Single-page static site for **webservicesforbusiness.com**. No build step.
Open `index.html` and the pages run. The contact form is the one server
piece: `/api/contact` uses nodemailer, so install dependencies before that
function can send mail.

```
.
├── index.html              the deploy build — markup, CSS and JS inline
├── index.standalone.html   same page with fonts inlined; opens with no server
├── api/contact.js          enquiry endpoint — Google SMTP via nodemailer
├── package.json            nodemailer dependency for that endpoint
├── robots.txt              allows indexing — the site is live
├── fonts/                  Archivo + IBM Plex Mono (woff2, latin subset)
├── img/og.png              1200×630 social share card
├── img/work/               screenshots of the portfolio sites — SEE BELOW
└── tools/                  screenshot capture script
```

## Deploy

Vercel: import this repository, Framework Preset **Other**, and leave Root
Directory, build, and output empty — the site is served from the repository
root as-is. Vercel installs `nodemailer` for `/api/contact.js`. Leave the
build command empty. Any static host can serve the pages; the form needs that
Function to deliver mail.

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
name, email, and message, ignores a filled honeypot, and sends the enquiry
through Google SMTP (`smtp.gmail.com`, port 465) as
`ryan@webservicesforbusiness.com`, to that same address. Reply-To is the
visitor, so a reply goes straight back to them. The subject is
`WSFB enquiry from {name}`. The button label is **Send** on the form, on the
mobile jump link beside the contact details, and on the mobile dock.

Mail is not delivered until `SMTP_USER` and `SMTP_PASS` are set. If either is
missing, or Gmail rejects the send, the page stays up and shows the phone and
email fallback. Nothing in the repository is a secret.

On the Google account `ryan@webservicesforbusiness.com`:

1. Turn on [2-step verification](https://myaccount.google.com/signinoptions/two-step-verification).
2. Create an [app password](https://myaccount.google.com/apppasswords). If that page is blocked, a Workspace admin has to allow app passwords for the account. Do not use the normal mailbox password.

Then on the Vercel project **webservicesforbusiness** → Settings →
Environment Variables, set both for **Production** and redeploy:

| Variable | Required | Value |
| --- | --- | --- |
| `SMTP_USER` | Yes | `ryan@webservicesforbusiness.com` |
| `SMTP_PASS` | Yes | The Google app password from the step above |

See `.env.example`. Run `node --test tools/enquiry.test.cjs` to check the endpoint.
