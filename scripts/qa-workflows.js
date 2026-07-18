'use strict';
const fs = require('node:fs'); const path = require('node:path'); const YAML = require('yaml');
for (const file of fs.readdirSync('.github/workflows').filter((name) => /\.ya?ml$/.test(name))) { YAML.parse(fs.readFileSync(path.join('.github/workflows', file), 'utf8')); console.log(`workflow YAML valid: ${file}`); }
