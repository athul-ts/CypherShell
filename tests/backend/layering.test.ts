/**
 * [NFR-06][BL-42] Controllers hold no database access: business logic and queries live in services.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const CONTROLLERS = path.resolve('backend/src/controllers')

/** The reasons a controller source breaks the rule; empty when it follows it. */
export function layeringViolations(source: string): string[] {
  const found: string[] = []
  if (/from\s+['"][^'"]*config\/db['"]/.test(source)) found.push('imports the database module')
  if (/\bprisma\s*\./.test(source)) found.push('calls prisma directly')
  return found
}

describe('[BL-42] layering guard', () => {
  it('flags a controller that imports the database or calls prisma', () => {
    expect(layeringViolations(`import { prisma } from '../config/db'`)).toEqual([
      'imports the database module'
    ])
    expect(layeringViolations(`const x = await prisma.profile.findMany()`)).toEqual([
      'calls prisma directly'
    ])
    expect(
      layeringViolations(`import { ProfileService } from '../services/profile.service'`)
    ).toEqual([])
  })

  const files = fs.readdirSync(CONTROLLERS).filter((f) => f.endsWith('.ts'))

  it('finds the controllers', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it.each(files)('%s has no database access', (file) => {
    const source = fs.readFileSync(path.join(CONTROLLERS, file), 'utf8')
    expect(layeringViolations(source)).toEqual([])
  })
})
