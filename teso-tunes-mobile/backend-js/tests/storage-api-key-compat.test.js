import assert from 'node:assert/strict';
import test from 'node:test';
import { createSupabasePersistence } from '../supabasePersistence.js';

for (const [label, key, expectedBearer] of [
  ['modern Supabase secret key', 'sb_secret_illustrative_test_key', false],
  ['legacy Supabase service_role JWT', 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.fake.jwt', true],
]) {
  test(`${label}: upload and private object stream use correct headers`, async () => {
    const requests = [];
    const previousFetch = globalThis.fetch;
    const stubFetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: options.method === 'POST' ? 200 : 206,
        headers: new Headers({ 'content-type': 'audio/mpeg' }),
        body: null,
      };
    };
    globalThis.fetch = stubFetch;
    try {
    const persistence = createSupabasePersistence({
      databaseUrl: 'postgresql://unused:unused@127.0.0.1/unused',
      supabaseUrl: 'https://staging-example.invalid',
      secretKey: key,
      buckets: {
        audio: 'music-audio', artwork: 'artwork', avatars: 'avatars', supportAttachments: 'support-attachments',
      },
      storageUrlFor: (bucket, objectPath) => `/api/storage/${bucket}/${objectPath}`,
      storageFetch: stubFetch,
    });

    await persistence.uploadFile({
      fieldname: 'audio_upload', originalname: 'test.mp3', mimetype: 'audio/mpeg', buffer: Buffer.from('audio'),
    });
    await persistence.uploadSupportAttachment({
      fieldname: 'cover_upload', originalname: 'receipt.png', mimetype: 'image/png', buffer: Buffer.from('image'),
    });
    const response = {
      headers: {},
      set(k, v) { this.headers[k] = v; return this; },
      get(k) { return this.headers[k]; },
      status(v) { this.statusCode = v; return this; },
      end() { this.ended = true; return this; },
      json() { throw new Error('Unexpected error response.'); },
    };
    await persistence.streamObject({
      params: { bucket: 'artwork', 0: 'songs/covers/test.png' },
      get(k) { return k === 'range' ? 'bytes=0-10' : ''; },
    }, response);
    assert.equal(response.statusCode, 206);
    assert.equal(response.ended, true);
    assert.equal(requests.length, 3);
    for (const { url, options } of requests) {
      assert.ok(url.startsWith('https://staging-example.invalid/storage/v1/object/'));
      assert.equal(options.headers.apikey, key);
      assert.equal(options.headers.authorization, expectedBearer ? `Bearer ${key}` : undefined);
    }
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[1].options.method, 'POST');
    assert.equal(requests[2].options.headers.range, 'bytes=0-10');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
}
