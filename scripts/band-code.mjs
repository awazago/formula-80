// Gera o SQL para definir o código da banda no D1.
// Uso: node scripts/band-code.mjs "codigo" | npx wrangler d1 execute formula-80-db --remote --command="$(cat)"
import { createHash, randomUUID } from 'node:crypto'

const code = process.argv[2]
if (!code || code.length < 6) {
  console.error('Informe um código com pelo menos 6 caracteres')
  process.exit(1)
}
const salt = randomUUID()
const hash = createHash('sha256').update(`${salt}:${code.trim()}`).digest('hex')
console.log(
  `INSERT OR REPLACE INTO settings (key, value) VALUES ('band_code_salt', '${salt}'), ('band_code_hash', '${hash}');`,
)
