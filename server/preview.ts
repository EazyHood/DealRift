import path from 'node:path'
import { startRadarServer } from './index.js'

const port = Number(process.env.PREVIEW_PORT ?? 4173)
const started = await startRadarServer({
  host: '127.0.0.1',
  port,
  staticDir: path.resolve('dist'),
})

console.log(`DealRift production preview listening on http://${started.host}:${started.port}`)
