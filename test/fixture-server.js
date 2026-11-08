import http from 'node:http'

export async function startFixtureServer() {
  const server = http.createServer(handle)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const pathname = url.pathname
  const name = decodeURIComponent(pathname.split('/').at(-1) ?? '')

  if (pathname === '/status/available') return send(res, 404, 'not found')
  if (pathname === '/status/blocked') return send(res, 403, 'Forbidden')
  if (pathname === '/status/rate') return send(res, 429, 'Too Many Requests')
  if (pathname === '/status/error') return send(res, 500, 'boom')
  if (pathname === '/status/always') return send(res, 200, 'profile')
  if (pathname.startsWith('/status/user/')) {
    return name === 'alice' ? send(res, 200, 'profile') : send(res, 404, 'not found')
  }
  if (pathname.startsWith('/status/redirect/')) {
    res.writeHead(302, { location: `/status/user/${encodeURIComponent(name)}` })
    return res.end()
  }
  if (pathname.startsWith('/status/head405/')) {
    if (req.method === 'HEAD') return send(res, 405, 'method not allowed')
    return name === 'alice' ? send(res, 200, 'profile') : send(res, 404, 'not found')
  }
  if (pathname.startsWith('/message/known/')) {
    return name === 'alice'
      ? send(res, 200, 'Welcome, this is a real profile')
      : send(res, 200, 'This account does not exist')
  }
  if (pathname === '/message/always') return send(res, 200, 'Welcome, this is a real profile')
  if (pathname.startsWith('/response/known/')) {
    if (name === 'alice') return send(res, 200, 'profile')
    res.writeHead(302, { location: '/response/error' })
    return res.end()
  }
  if (pathname === '/response/error') return send(res, 200, 'this page means not found')
  if (pathname === '/waf') return send(res, 200, '<html>Just a moment...</html>')
  if (pathname === '/slow') {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    return send(res, 200, 'slow profile')
  }
  if (pathname === '/big') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.write('A'.repeat(1024 * 1024))
    res.end('This account does not exist')
    return
  }
  if (pathname === '/post') {
    const body = await readBody(req)
    let parsed
    try { parsed = JSON.parse(body) } catch { return send(res, 400, 'bad json') }
    return parsed?.username === 'alice' ? send(res, 200, '{"ok":true}') : send(res, 404, '{"ok":false}')
  }
  if (pathname.startsWith('/headers/')) {
    const language = req.headers['accept-language'] ?? ''
    return language.includes('en-US') && name === 'alice'
      ? send(res, 200, 'profile')
      : send(res, 404, 'not found')
  }
  return send(res, 404, 'unknown fixture route')
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}
