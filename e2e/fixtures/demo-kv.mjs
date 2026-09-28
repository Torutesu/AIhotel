// ローカルE2E専用。Upstash RESTプロトコルをメモリで再現し、外部データを変更しない。
import { createServer } from 'node:http'
const strings = new Map()
const hashes = new Map()
createServer(async (req, res) => {
  if (req.method === 'GET') { res.end('ready'); return }
  if (req.headers.authorization !== 'Bearer local-e2e-only') { res.writeHead(401).end(); return }
  let body = ''
  for await (const chunk of req) body += chunk
  try {
    const [cmd, key, ...args] = JSON.parse(body)
    let result = null
    if (cmd === 'GET') result = strings.get(key) ?? null
    else if (cmd === 'SET') {
      if (!strings.has(key)) { strings.set(key, args[0]); result = 'OK' }
    } else if (cmd === 'HGETALL') result = Array.from(hashes.get(key) ?? []).flat()
    else if (cmd === 'HSET') {
      if (!hashes.has(key)) hashes.set(key, new Map())
      hashes.get(key).set(args[0], args[1]); result = 1
    } else if (cmd === 'HDEL') result = Number(hashes.get(key)?.delete(args[0]) ?? false)
    else if (cmd === 'INCR') { result = Number(strings.get(key) ?? 0) + 1; strings.set(key, String(result)) }
    else if (cmd === 'EXPIRE') result = 1
    else if (cmd === 'DEL') { strings.delete(key); hashes.delete(key); result = 1 }
    else throw new Error('unsupported command')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ result }))
  } catch { res.writeHead(400).end(JSON.stringify({ error: 'invalid test command' })) }
}).listen(4199, '127.0.0.1')
