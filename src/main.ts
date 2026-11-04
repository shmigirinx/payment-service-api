import 'dotenv/config';
import { createApp } from './app';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  await app.listen(port, '0.0.0.0');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
