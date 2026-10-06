const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const { buildHomeSections } = await import('data:text/javascript;base64,' + fs.readFileSync('src/utils/discovery.js').toString('base64'));
  const data = {}, requests = [];
  for (const [key, endpoint] of Object.entries({ newSongs: 'songs/?discovery=new&limit=16', popular: 'songs/?discovery=popular&limit=16', featured: 'songs/?discovery=featured&limit=12', more: 'songs/?discovery=more&limit=16', artists: 'artists/?discovery=featured&limit=8', genres: 'genres/' })) {
    const start = performance.now();
    const response = await fetch('https://teso-music-app.onrender.com/api/' + endpoint, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw Error(`${endpoint}: ${response.status}`);
    data[key] = await response.json();
    requests.push({ key, returned: data[key].length, ms: Math.round(performance.now() - start) });
  }
  const sections = buildHomeSections(data);
  const report = { at: new Date().toISOString(), requests, displayed: Object.fromEntries(Object.entries(sections).map(([key, items]) => [key, items.length])), featuredArtists: data.artists.filter(x => x.is_featured).length, genres: data.genres, newest: data.newSongs.map(x => ({ id: x.id, status: x.status, release_date: x.release_date })), positivePopular: data.popular.every(x => x.play_count > 0), newDatesValid: data.newSongs.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x.release_date) && x.status === 'published') };
  const catalogResponse = await fetch('https://teso-music-app.onrender.com/api/songs/', { signal: AbortSignal.timeout(45000) });
  if (!catalogResponse.ok) throw Error(`Catalog audit: ${catalogResponse.status}`);
  const catalog = await catalogResponse.json();
  const today = new Date().toISOString().slice(0, 10);
  const validDate = song => /^\d{4}-\d{2}-\d{2}$/.test(song.release_date || '') && !Number.isNaN(Date.parse(song.release_date)) && new Date(song.release_date).toISOString().slice(0, 10) === song.release_date;
  report.catalog = { total: catalog.length, published: catalog.filter(song => song.status === 'published').length, validReleaseDates: catalog.filter(validDate).length, futureDates: catalog.filter(song => validDate(song) && song.release_date > today).length };
  report.newestFirst = data.newSongs.every((song, index) => !index || song.release_date <= data.newSongs[index - 1].release_date);
  const healthResponse = await fetch('https://teso-music-app.onrender.com/healthz', { signal: AbortSignal.timeout(45000) });
  const health = await healthResponse.json();
  report.health = { status: healthResponse.status, persistence: health.persistence_backend };
  const sample = data.newSongs[0];
  const media = await fetch(sample.audio_file, { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(45000) });
  report.audio = { songId: sample.id, privateStorageProxy: new URL(sample.audio_file).pathname.startsWith('/api/storage/music-audio/'), status: media.status, contentType: media.headers.get('content-type'), contentRange: media.headers.get('content-range') };
  await media.body?.cancel();
  const output = path.join(require('node:os').tmpdir(), 'tesohub-listener-audit.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
