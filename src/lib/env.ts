import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env'),
]

const envPath = envCandidates.find((candidate) => fs.existsSync(candidate))
dotenv.config(envPath ? { path: envPath } : undefined)

