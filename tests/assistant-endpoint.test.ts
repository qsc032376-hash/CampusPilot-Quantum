import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/assistant.ts';

function makeRequest(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const request = {
    method,
    on(event, listener) {
      if (event === 'data') chunks.forEach((chunk) => listener(chunk));
      if (event === 'end') listener();
      return request;
    },
    destroy() { /* no-op */ },
  };
  return request;
}

function makeResponse() {
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { response.headers[name] = value; },
    end(value) { response.body = value; },
  };
  return response;
}

function clearEnv() {
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
}

test('an unconfigured deployment answers 503 instead of faking a reply', async () => {
  clearEnv();
  const response = makeResponse();
  await handler(makeRequest('POST', { messages: [{ role: 'user', content: 'hi' }] }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, 'unconfigured');
});

test('only POST is accepted', async () => {
  clearEnv();
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = 'https://example.invalid/v1';
  process.env.AI_MODEL = 'test-model';
  const response = makeResponse();
  await handler(makeRequest('GET'), response);
  assert.equal(response.statusCode, 405);
  assert.equal(JSON.parse(response.body).error, 'method_not_allowed');
  clearEnv();
});

test('a malformed body is rejected before any model call', async () => {
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = 'https://example.invalid/v1';
  process.env.AI_MODEL = 'test-model';
  const response = makeResponse();
  await handler(makeRequest('POST', { messages: [] }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'invalid_request');
  clearEnv();
});

test('an upstream failure is reported as an error, never as a draft', async () => {
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = 'https://example.invalid/v1';
  process.env.AI_MODEL = 'test-model';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 500 });
  const response = makeResponse();
  await handler(makeRequest('POST', { messages: [{ role: 'user', content: 'hi' }] }), response);
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).error, 'upstream_error');
  globalThis.fetch = originalFetch;
  clearEnv();
});

test('a question reply passes through unchanged', async () => {
  process.env.AI_API_KEY = 'test-key';
  process.env.AI_BASE_URL = 'https://example.invalid/v1';
  process.env.AI_MODEL = 'test-model';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ kind: 'question', question: 'When is it due?' }) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const response = makeResponse();
  await handler(makeRequest('POST', { messages: [{ role: 'user', content: 'write my essay' }] }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { kind: 'question', question: 'When is it due?' });
  globalThis.fetch = originalFetch;
  clearEnv();
});
