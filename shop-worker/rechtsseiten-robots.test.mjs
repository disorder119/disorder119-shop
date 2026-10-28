import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RECHTSSEITEN_ROBOTS, rechtsseitenRobots } from './rechtsseiten-robots.js';

test('only legal pages in every language and the two legal scripts are marked', () => {
  for (const lang of ['', '/en', '/fr']) {
    for (const page of ['impressum', 'agb', 'datenschutz', 'widerruf']) {
      for (const tail of ['', '/', '/index.html']) assert.equal(rechtsseitenRobots(`${lang}/${page}${tail}`), RECHTSSEITEN_ROBOTS);
    }
  }
  for (const path of ['/', '/faq/', '/ueber-uns/', '/impressumx/', '/de/impressum/', '/artikel/impressum/', '/assets/app.css', '/assets/article.js', '', null]) {
    assert.equal(rechtsseitenRobots(path), '', String(path));
  }
});

test('robots.txt keeps search engines able to see noindex and shuts AI crawlers out of the legal pages', () => {
  const text = fs.readFileSync(new URL('../robots.txt', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const gruppen = text.split(/\n\s*\n/).map(block => {
    const zeilen = block.split('\n').map(z => z.trim()).filter(z => z && !z.startsWith('#'));
    return { agents: zeilen.filter(z => /^user-agent:/i.test(z)).map(z => z.split(':')[1].trim()),
      disallow: zeilen.filter(z => /^disallow:/i.test(z)).map(z => z.slice(9).trim()) };
  }).filter(g => g.agents.length);
  const fuer = name => gruppen.find(g => g.agents.includes(name)) || gruppen.find(g => g.agents.includes('*'));
  const rechtsseiten = ['/impressum', '/agb', '/datenschutz', '/widerruf'].flatMap(p => [p, '/en' + p, '/fr' + p]);
  for (const bot of ['Googlebot', 'Bingbot', 'Storebot-Google', 'AdsBot-Google', 'facebookexternalhit']) {
    const g = fuer(bot);
    for (const p of rechtsseiten) assert.ok(!g.disallow.includes(p), `${bot} darf ${p} nicht gesperrt bekommen`);
    assert.ok(!g.disallow.includes('/') && !g.disallow.includes('/assets/app.js'), bot);
  }
  for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'CCBot',
    'Google-Extended', 'PerplexityBot', 'Perplexity-User', 'Applebot-Extended', 'Bytespider', 'meta-externalagent']) {
    const g = fuer(bot);
    assert.ok(g && !g.agents.includes('*'), bot);
    for (const p of [...rechtsseiten, '/assets/app.js', '/assets/legal-content.js']) assert.ok(g.disallow.includes(p), `${bot} ${p}`);
    // Eigene Gruppe ersetzt die *-Gruppe: interne Pfade dort wiederholen.
    for (const p of ['/admin/', '/config/', '/scripts/', '/shop-worker/', '/data/items.json']) assert.ok(g.disallow.includes(p), `${bot} ${p}`);
    assert.ok(!g.disallow.includes('/'), bot);
  }
});
