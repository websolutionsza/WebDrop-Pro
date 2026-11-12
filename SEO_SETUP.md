# Google Search Console Setup Guide — WebDrop Pro

This guide walks you through adding https://webdrop-pro.pages.dev/ to Google Search Console, verifying ownership, submitting the sitemap, and inspecting indexing issues.

WebDrop Pro is already technically prepared for Google Search Console:

- `/sitemap.xml` is published and lists the public marketing pages.
- `/robots.txt` allows crawling of public pages and points to the sitemap.
- HTML verification files can be dropped into the project root (Cloudflare Pages serves them at the site root).
- A `googleeb5886c3fdaa9bfd.html` verification file is already present in the repository (from a previous setup) — you can keep it or replace it with your own.

---

## 1. Add the website to Google Search Console

1. Open https://search.google.com/search-console.
2. Sign in with the Google account you want to use to manage this site.
3. In the top-left dropdown, click **Add property**.
4. Choose **URL prefix** and enter exactly: `https://webdrop-pro.pages.dev/`.
   (Use the **Domain** alternative only if you have registered a custom domain pointing at Cloudflare Pages. For the default `*.pages.dev` URL, **URL prefix** is the correct choice.)
5. Click **Continue**.

## 2. Verify ownership

You have two practical options for a Cloudflare Pages site.

### Option A — HTML file verification (recommended for pages.dev subdomain)

1. In Search Console, choose **HTML file** under the verification methods.
2. Download the suggested verification file. It will look something like `googleXXXXXXXXXXXXXXXX.html`.
3. Place that file at the **root** of your GitHub repository (the same folder as `index.html`). Cloudflare Pages will serve it at `https://webdrop-pro.pages.dev/googleXXXXXXXXXXXXXXXX.html`.
4. Push the file to your GitHub `main` branch. Wait for Cloudflare Pages to finish deploying.
5. Open the verification URL in a browser to confirm it loads with the expected one-line content.
6. Back in Search Console, click **Verify**.

A pre-existing `googleeb5886c3fdaa9bfd.html` file is already in the repository. If you have already verified the site with that file, no further action is needed. If you are verifying a new property, replace it with the file Google gives you.

### Option B — DNS TXT verification (recommended for custom domains)

Use this option if you have a custom domain (e.g. `webdrop.app`) pointing at Cloudflare Pages.

1. In Search Console, choose **Domain name property** and enter your apex domain.
2. Google gives you a single **TXT record** value (a long string starting with `google-site-verification=`).
3. Open the Cloudflare dashboard → your domain → **DNS** → **Records**.
4. Click **Add record**:
   - Type: `TXT`
   - Name: `@` (apex)
   - Content: the full verification string Google gave you
   - TTL: Auto
5. Save. Wait 5–30 minutes for DNS propagation.
6. Back in Search Console, click **Verify**.

## 3. Where to insert the verification token

- For HTML-file verification: place the file in the **repository root** (alongside `index.html`). It is served as a static file by Cloudflare Pages at `/<filename>`.
- For DNS TXT verification: insert the TXT record in **Cloudflare DNS** for your domain. Do **not** put the token anywhere in the JavaScript bundle or HTML.
- For `<meta name="google-site-verification" content="...">` verification (alternative): add the tag to the `<head>` of `index.html`. This is supported but less common than the HTML-file method.

## 4. Submit the sitemap

1. In Search Console, open your property.
2. In the left sidebar, click **Sitemaps**.
3. Enter `sitemap.xml` (the canonical URL `https://webdrop-pro.pages.dev/sitemap.xml` will be filled in automatically).
4. Click **Submit**.
5. After a few minutes, the status should change to **Success**. The report will show how many URLs were discovered.

The WebDrop Pro sitemap includes:
- `/` (home / application)
- `/terms.html`
- `/privacy.html`

Private application URLs (session codes, signaling endpoints, transfer URLs) are deliberately excluded.

## 5. Inspect indexing issues

1. Use the **URL Inspection** tool (top of Search Console) to check the indexing status of a specific page.
2. For the homepage, paste `https://webdrop-pro.pages.dev/` and press Enter.
3. Click **Test live URL** to see what Google's renderer sees (WebDrop Pro is a JavaScript application — the rendered DOM matters, not the raw HTML alone).
4. If the live test shows the page is reachable and rendered, click **Request indexing**.
5. Common issues to look out for:
   - **Crawled but not indexed**: usually resolves with time and external backlinks.
   - **Blocked by robots.txt**: ensure you didn't accidentally disallow `/`.
   - **Soft 404**: ensure the page returns real content (the home page does).
   - **Mobile usability**: WebDrop Pro is mobile-first responsive; you should see a "Page is mobile-friendly" result.

## 6. Performance and structured data

Search Console also reports on:

- **Core Web Vitals**: WebDrop Pro uses lightweight CSS/SVG animations; should land in the "Good" band for LCP and CLS.
- **Structured data**: WebDrop Pro includes `WebApplication` JSON-LD in the page `<head>`. Search Console → **Enhancements** → **Structured data** will report if Google found any issues with the schema.

## 7. Notes specific to Cloudflare Pages

- All static files at the repository root (e.g. `robots.txt`, `sitemap.xml`, `llms.txt`, the Google verification HTML) are served as-is by Cloudflare Pages at the site root.
- No build step is required — the project is a static site with no bundler.
- Functions under `/functions/api/*` are deployed as Cloudflare Pages Functions and are correctly disallowed in `robots.txt`.

---

If you have already verified the site using the existing `googleeb5886c3fdaa9bfd.html` file, you only need to do step 4 (submit the sitemap) and step 5 (inspect the homepage) to complete the setup.
