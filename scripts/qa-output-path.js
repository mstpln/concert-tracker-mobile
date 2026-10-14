'use strict';

const fs = require('node:fs');
const path = require('node:path');

function resolveQaOutputPath(projectRoot, requestedOutput) {
  const root = path.resolve(projectRoot);
  const output = requestedOutput ? path.resolve(root, requestedOutput) : path.join(root, 'dist');
  const relativeOutput = path.relative(root, output);
  const allowedOutput = relativeOutput === 'dist'
    || relativeOutput === 'qa-artifacts'
    || relativeOutput.startsWith(`qa-artifacts${path.sep}`)
    || relativeOutput === '.qa-build-staging'
    || /^\.qa-build-test-\d+$/.test(relativeOutput);

  if (!allowedOutput) {
    throw new Error('QA output must use a dedicated generated-output directory');
  }

  let ancestor = root;
  for (const segment of relativeOutput.split(path.sep)) {
    ancestor = path.join(ancestor, segment);
    if (!fs.existsSync(ancestor)) break;
    if (fs.lstatSync(ancestor).isSymbolicLink()) {
      throw new Error('QA output path may not traverse symbolic links');
    }
  }

  return output;
}

module.exports = resolveQaOutputPath;
