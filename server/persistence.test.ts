import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeJsonAtomic } from './persistence.js'

test('atomic JSON writes replace complete files and clean temporary data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dealrift-persistence-'))
  const file = path.join(directory, 'history.json')

  try {
    await writeJsonAtomic(file, { version: 1, values: [1, 2] })
    await writeJsonAtomic(file, { version: 2, values: [3, 4] })

    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 2, values: [3, 4] })
    assert.deepEqual(await readdir(directory), ['history.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
