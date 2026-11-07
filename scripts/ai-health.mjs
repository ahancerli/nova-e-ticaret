// Health check of the AI integrations against the real providers — no DB, no panel. For every model in the
// ai_models upsert of db/schema.sql: the model lookup (free; proves key + model) and, with --generate, one tiny
// generation through the same client the app uses (costs a few tokens).
// Keys come from the environment or .env.local: OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY (providers
// without a key are skipped). Keys are never printed.
//   npm run ai:health
//   npm run ai:health -- --provider=gemini --model=gemini-3.6-flash --generate
import { readFileSync } from "node:fs"
import { loadEnv } from "./env.mjs"

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "")
loadEnv(process.env.ENV_FILE || ".env.local")
const { httpAiClients } = await import(`${ROOT}/src/modules/ai/infrastructure/ai-clients.ts`)
const { CONNECTION_TEST_PROMPT } = await import(`${ROOT}/src/modules/ai/prompts/system-prompts.ts`)

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const onlyProvider = arg("provider")
const onlyModel = arg("model")
const generate = process.argv.includes("--generate")
const KEYS = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY" }

const schema = readFileSync(`${ROOT}/db/schema.sql`, "utf8")
const block = schema.slice(schema.indexOf("INSERT INTO ai_models"))
const catalog = [...block.matchAll(/^\s*\('(openai|gemini|anthropic)','([^']+)',.*,'(active|deprecated|retired)',/gm)]
	.map(([, provider, model, status]) => ({ provider, model, status }))
	.filter((m) => m.status !== "retired" && (!onlyProvider || m.provider === onlyProvider))
if (onlyModel) {
	const p = onlyProvider || catalog.find((m) => m.model === onlyModel)?.provider
	if (!p) { console.error("✖ --model needs --provider when the model is not in the catalog"); process.exit(2) }
	catalog.splice(0, catalog.length, { provider: p, model: onlyModel, status: "manual" })
}

const clients = httpAiClients()
const sec = (ms) => `${(ms / 1000).toFixed(1)}s`
const failText = (e) => `${e?.code ?? "error"} ${JSON.stringify(e?.details ?? {})} — ${e?.message ?? e}`
let failed = 0
let checked = 0
for (const [provider, envName] of Object.entries(KEYS)) {
	const rows = catalog.filter((m) => m.provider === provider)
	if (!rows.length) continue
	const apiKey = process.env[envName]
	if (!apiKey) { console.log(`\n${provider}: skipped (${envName} not set)`); continue }
	console.log(`\n${provider}`)
	for (const { model, status } of rows) {
		checked++
		const client = clients(provider)
		let line = `  ${model.padEnd(24)} ${status.padEnd(10)} `
		try {
			let t = Date.now()
			const info = await client.checkModel(apiKey, model)
			line += `model ✓ ${sec(Date.now() - t)}${info.deprecated ? ` (provider: deprecated${info.retiresAt ? ` → ${info.retiresAt}` : ""})` : ""}`
			if (generate) {
				t = Date.now()
				const text = await client.generate({ model, apiKey, system: CONNECTION_TEST_PROMPT.system, text: CONNECTION_TEST_PROMPT.user, images: [], maxTokens: 1024, json: false })
				line += ` · generate ✓ ${sec(Date.now() - t)} "${text.trim().slice(0, 30)}"`
			}
		} catch (e) {
			failed++
			line += `✖ ${failText(e)}`
		}
		console.log(line)
	}
}
console.log(failed ? `\n✖ ${failed} of ${checked} model(s) failed` : checked ? `\n✓ ${checked} model(s) OK` : "\n✖ nothing checked: set at least one API key")
process.exit(failed || !checked ? 1 : 0)
