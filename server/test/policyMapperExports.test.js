const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policyMapper = require('../src/services/policyMapper');

test('todo lo que policyService importa de policyMapper existe', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/policyService.js'), 'utf8');
  const bloque = src.match(/const \{([^}]+)\} = require\('\.\/policyMapper'\);/)[1];
  const nombres = bloque.split(',').map((n) => n.trim()).filter(Boolean);
  assert.ok(nombres.includes('resolveRcvCramo'));
  for (const n of nombres) assert.equal(typeof policyMapper[n], 'function', n);
});
