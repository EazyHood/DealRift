import { startRadarServer } from './index.js'

const port = Number(process.env.PORT ?? 5174)

startRadarServer({ port, host: '127.0.0.1' })
  .then((started) => {
    console.log(`Game Deal Radar API listening on http://localhost:${started.port}`)
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
