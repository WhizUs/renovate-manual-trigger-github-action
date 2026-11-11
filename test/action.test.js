import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const actionPath = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const actionDirectory = fileURLToPath(new URL('..', import.meta.url));
const issuesPath = '/repos/example/project/issues';
const dashboardTitle = 'Dependency Dashboard';
const manualJobText = '<!-- manual job -->Check this box to trigger a request for Renovate to run again on this repository';
const unchecked = `[ ] ${manualJobText}`;
const checked = `[x] ${manualJobText}`;
const dashboard = { number: 42, title: dashboardTitle };

function otherIssues(count) {
  return Array.from({ length: count }, (_, index) => ({
    number: index + 100,
    title: `Issue ${index}`,
  }));
}

async function runAction({ issues = [dashboard], issue = {}, failOn } = {}) {
  const details = { ...dashboard, state: 'open', body: `- ${unchecked}\n`, ...issue };
  const requests = [];
  let patchedBody;
  let baseUrl;
  const server = createServer((request, response) => {
    const url = new URL(request.url, baseUrl);
    requests.push({
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
    });
    response.setHeader('content-type', 'application/json');

    function send(status, body) {
      response.statusCode = status;
      response.end(JSON.stringify(body));
    }

    if (request.method === 'GET' && url.pathname === issuesPath) {
      if (failOn === 'list') return send(403, { message: 'list denied' });
      const page = Number(url.searchParams.get('page') || 1);
      const pageSize = Number(url.searchParams.get('per_page') || 30);
      const start = (page - 1) * pageSize;
      if (start + pageSize < issues.length) {
        const next = new URL(url);
        next.searchParams.set('page', String(page + 1));
        response.setHeader('link', `<${next.href}>; rel="next"`);
      }
      return send(200, issues.slice(start, start + pageSize));
    }

    if (request.method === 'GET' && url.pathname === `${issuesPath}/${dashboard.number}`) {
      if (failOn === 'get') return send(403, { message: 'get denied' });
      return send(200, details);
    }

    if (request.method === 'PATCH' && url.pathname === `${issuesPath}/${dashboard.number}`) {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        if (failOn === 'update') return send(403, { message: 'update denied' });
        patchedBody = JSON.parse(body);
        return send(200, { ...details, ...patchedBody });
      });
      return;
    }

    return send(404, { message: 'Unexpected request' });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  let timer;

  try {
    const child = spawn(process.execPath, [actionPath], {
      cwd: actionDirectory,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        GITHUB_ACTION: 'test',
        GITHUB_API_URL: baseUrl,
        INPUT_TOKEN: 'test-token',
        'INPUT_RENOVATE-REPOSITORY': 'example/project',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    timer.unref();
    const [code, signal] = await once(child, 'close');
    return { code, signal, output, requests, patchedBody };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('searches all pages and changes only the manual checkbox', async () => {
  const body = `Dashboard\r\n- ${unchecked}\r\nOther text \u{1F680}\n`;
  const result = await runAction({
    issues: [...otherIssues(100), dashboard],
    issue: { body },
  });

  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.requests.map(({ method, path }) => [method, path]), [
    ['GET', issuesPath],
    ['GET', issuesPath],
    ['GET', `${issuesPath}/42`],
    ['PATCH', `${issuesPath}/42`],
  ]);
  assert.equal(result.requests[0].query.state, 'open');
  assert.equal(result.requests[0].query.per_page, '100');
  assert.equal(result.requests[1].query.page, '2');
  assert.deepEqual(result.patchedBody, {
    body: `Dashboard\r\n- ${checked}\r\nOther text \u{1F680}\n`,
  });
});

test('ignores a pull request with the dashboard title', async () => {
  const result = await runAction({
    issues: [{ number: 99, title: dashboardTitle, pull_request: {} }, dashboard],
  });

  assert.equal(result.code, 0, result.output);
  assert.equal(result.requests[1].path, `${issuesPath}/42`);
  assert.deepEqual(result.patchedBody, { body: `- ${checked}\n` });
});

test('stops pagination and does not update an already checked dashboard', async () => {
  const result = await runAction({
    issues: [dashboard, ...otherIssues(100)],
    issue: { body: `- ${checked}\n` },
  });

  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /already checked/i);
  assert.deepEqual(result.requests.map(({ method, path }) => [method, path]), [
    ['GET', issuesPath],
    ['GET', `${issuesPath}/42`],
  ]);
  assert.equal(result.patchedBody, undefined);
});

test('reports a missing dashboard after searching all pages', async () => {
  const result = await runAction({ issues: otherIssues(101) });

  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /open Dependency Dashboard issue not found/i);
  assert.deepEqual(result.requests.map(({ method, path }) => [method, path]), [
    ['GET', issuesPath],
    ['GET', issuesPath],
  ]);
  assert.equal(result.patchedBody, undefined);
});

test('rejects missing or unexpected dashboard bodies', async (t) => {
  for (const [name, body, expected] of [
    ['missing body', null, /has no body/i],
    ['missing checkbox', 'An unexpected dashboard body', /manual trigger checkbox not found/i],
  ]) {
    await t.test(name, async () => {
      const result = await runAction({ issue: { body } });
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, expected);
      assert.equal(result.patchedBody, undefined);
    });
  }
});

test('rejects a dashboard that was closed or renamed after listing', async (t) => {
  for (const [name, issue] of [
    ['closed', { state: 'closed' }],
    ['renamed', { title: 'Another issue' }],
  ]) {
    await t.test(name, async () => {
      const result = await runAction({ issue });
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /no longer an open Dependency Dashboard/i);
      assert.equal(result.patchedBody, undefined);
    });
  }
});

test('reports GitHub API errors', async (t) => {
  for (const operation of ['list', 'get', 'update']) {
    await t.test(operation, async () => {
      const result = await runAction({ failOn: operation });
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, new RegExp(`${operation} denied`));
      assert.equal(result.patchedBody, undefined);
    });
  }
});
