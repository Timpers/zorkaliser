import { createApp } from './app.js';

async function main() {
  const { app, config } = await createApp();

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(
    `[zorkaliser/api] Listening on http://${config.HOST}:${config.PORT} | LLM: ${config.resolvedLlmProvider} | Image: ${config.resolvedImageProvider}`,
  );
  if (config.resolvedImageProvider === 'mock') {
    console.log(
      '[zorkaliser/api] Running with keyless SVG preview provider. Add GEMINI_API_KEY to .env for live Google Gemini illustrations.',
    );
  }
}

main().catch((err) => {
  console.error('[zorkaliser/api] Failed to start:', err);
  process.exit(1);
});
