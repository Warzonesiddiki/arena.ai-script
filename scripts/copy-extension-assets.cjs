const fs = require('node:fs');
const path = require('node:path');

const source = path.resolve('extension/public');
const destination = path.resolve('dist');

if (!fs.existsSync(source)) {
  throw new Error(`Extension asset directory is missing: ${source}`);
}

fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true, force: true });
