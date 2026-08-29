function sanitizeForFs(name) {
  return String(name || '').trim()
    .replace(/\//g, '／')
    .replace(/[\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'untitled';
}

function extractYoutubeId(url) {
  try {
    const u = (url || '').trim();
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const parts = parsed.pathname.split('/').filter(Boolean);
      return parts[0] || null;
    }
    if (host.endsWith('youtube.com') || host === 'youtube.com') {
      const v = parsed.searchParams.get('v');
      if (v) return v;
      const m = parsed.pathname.match(/\/(?:shorts|embed|v|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
  } catch {}
  return null;
}

function buildExpectedFilename(title, youtubeId, ext) {
  const safeTitle = sanitizeForFs(title || '');
  const extension = (ext || '').startsWith('.') ? ext : `.${ext || ''}`;
  return `${safeTitle}${extension}`;
}

const cases = [
  {
    title: 'poster boy',
    id: 'jOLT6ukrQSg',
    ext: '.m4a',
    expected: 'poster boy.m4a',
  },
  {
    title: 'ふたつの木馬 (feat. Hatsune Miku)',
    id: 'lSreY_7i6No',
    ext: '.m4a',
    expected: 'ふたつの木馬 (feat. Hatsune Miku).m4a',
  },
  {
    title: 'テトリス / 重音テトSV',
    id: 'Soy4jGPHr3g',
    ext: '.m4a',
    expected: 'テトリス ／ 重音テトSV.m4a',
  },
  {
    title: '可愛くてごめん feat. ちゅーたん（CV：早見沙織）／HoneyWorks',
    id: 'K4xLi8IF1FM',
    ext: '.m4a',
    expected: '可愛くてごめん feat. ちゅーたん（CV：早見沙織）／HoneyWorks.m4a',
  },
  {
    title: '【歌ってみた】天天天国地獄国 / covered by ヨーメイ×ヒサメ',
    id: 'lhbwEO-RiT4',
    ext: '.m4a',
    expected: '【歌ってみた】天天天国地獄国 ／ covered by ヨーメイ×ヒサメ.m4a',
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const result = buildExpectedFilename(c.title, c.id, c.ext);
  if (result === c.expected) {
    console.log(`✅ PASS: ${c.title}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${c.title}`);
    console.log(`   expected: ${c.expected}`);
    console.log(`   got:      ${result}`);
    failed++;
  }
}

const urlTests = [
  { url: 'https://www.youtube.com/watch?v=lSreY_7i6No', expected: 'lSreY_7i6No' },
  { url: 'https://youtu.be/lSreY_7i6No', expected: 'lSreY_7i6No' },
  { url: 'https://www.youtube.com/watch?v=Soy4jGPHr3g&list=RD...', expected: 'Soy4jGPHr3g' },
];

for (const u of urlTests) {
  const result = extractYoutubeId(u.url);
  if (result === u.expected) {
    console.log(`✅ PASS extractYoutubeId: ${u.url}`);
    passed++;
  } else {
    console.log(`❌ FAIL extractYoutubeId: ${u.url}`);
    console.log(`   expected: ${u.expected}`);
    console.log(`   got:      ${result}`);
    failed++;
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
