import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function writeJsonAtomic(filePath: string, value: unknown) {
  const directory = path.dirname(filePath)
  const temporaryFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  )

  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await rename(temporaryFile, filePath)
  } catch (error) {
    await rm(temporaryFile, { force: true }).catch(() => undefined)
    throw error
  }
}
