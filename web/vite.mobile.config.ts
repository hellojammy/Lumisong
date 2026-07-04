import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    https: {
      cert: readFileSync('certs/dev-cert.pem'),
      key: readFileSync('certs/dev-key.pem'),
    },
  },
});
