export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  categoryRuleSuggestionsProvider:
    process.env.CATEGORY_RULE_SUGGESTIONS_PROVIDER ?? 'claude',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
  ollamaAdviceBaseUrl:
    process.env.OLLAMA_ADVICE_BASE_URL ?? 'http://localhost:11434',
  ollamaAdviceModel: process.env.OLLAMA_ADVICE_MODEL ?? 'qwen3:32b',
  ollamaDetectionModel: process.env.OLLAMA_DETECTION_MODEL ?? 'qwen3:32b',
  dataDir: process.env.DATA_DIR ?? './data',
  uploadDir: process.env.UPLOAD_DIR ?? './data/uploads',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '20', 10),
  appPin: process.env.APP_PIN ?? '',
  // Opt-in explicite pour démarrer sans APP_PIN en production. Sans ça,
  // l'app refuse de booter pour éviter une fail-open silencieuse.
  allowNoPin: process.env.ALLOW_NO_PIN ?? 'false',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  demoModeAvailable: process.env.DEMO_MODE_AVAILABLE !== 'false',
  // DEMO_FORCED=true : l'instance ENTIÈRE est verrouillée en démo, sans
  // dépendre d'aucun en-tête HTTP (cf. modules/demo/forced-demo.ts). Off par
  // défaut : l'instance locale aux vraies données n'est pas concernée.
  demoForcedAll: process.env.DEMO_FORCED === 'true',
  // Comma-separated list of host patterns that ALWAYS run in demo mode.
  // Any request whose Host header (never X-Forwarded-Host, which the client
  // controls) equals one of these host names or is a subdomain of it (exact or
  // dot-preceded suffix match, never a substring — forced-demo.ts) is locked
  // into demo (toggle disabled, banner permanent). Default covers Cloudflare
  // quick tunnels.
  demoForcedHosts: (process.env.DEMO_FORCED_HOSTS ?? 'trycloudflare.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});
