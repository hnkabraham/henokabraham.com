import { readdir, readFile } from 'node:fs/promises';
// Tells IndexNow's search engines (Bing, and through it DuckDuckGo, Yandex,
// Seznam, Naver) that the sitemap's pages changed, so they recrawl without
// a webmaster account. Run after a deploy that changes what a page says.
// The key is public by design: the engines fetch /<key>.txt to check that
// whoever pings owns the site.
const site = 'https://henokabraham.com';
const publicDir = new URL('../public/', import.meta.url);
const [keyFile] = (await readdir(publicDir)).filter((name) =>
  /^[0-9a-f]{32}\.txt$/.test(name),
);
if (!keyFile) throw new Error('No IndexNow key file in public/');
const key = (await readFile(new URL(keyFile, publicDir), 'utf8')).trim();
const sitemap = await readFile(new URL('sitemap.xml', publicDir), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  ([, url]) => url,
);
const live = await fetch(`${site}/${keyFile}`);
if (!live.ok || (await live.text()).trim() !== key)
  throw new Error(`${site}/${keyFile} doesn't serve the key yet: deploy first`);
const response = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: new URL(site).host,
    key,
    keyLocation: `${site}/${keyFile}`,
    urlList,
  }),
});
console.log(`IndexNow answered ${response.status} for ${urlList.join(', ')}`);
if (!response.ok) process.exit(1);
