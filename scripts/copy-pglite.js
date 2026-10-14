const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../node_modules/@electric-sql/pglite/dist');
const dst = path.resolve(__dirname, '../.vercel/output/functions/api/index.func/node_modules/@electric-sql/pglite/dist');

if (fs.existsSync(src) && fs.existsSync(path.dirname(dst))) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f.endsWith('.data') || f.endsWith('.wasm')) {
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
      console.log('[build] Copied PGlite asset:', f);
    }
  }
}
