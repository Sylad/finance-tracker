export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:4200',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  dataDir: process.env.DATA_DIR ?? './data',
  uploadDir: process.env.UPLOAD_DIR ?? './data/uploads',
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '20', 10),
  appPin: process.env.APP_PIN ?? '',
  demoModeAvailable: process.env.DEMO_MODE_AVAILABLE !== 'false',
  // Comma-separated list of host patterns that ALWAYS run in demo mode.
  // Any request whose Host header contains one of these substrings is locked
  // into demo (toggle disabled, banner permanent). Default covers Cloudflare
  // quick tunnels.
  demoForcedHosts: (process.env.DEMO_FORCED_HOSTS ?? 'trycloudflare.com').split(',').map((s) => s.trim()).filter(Boolean),
});
