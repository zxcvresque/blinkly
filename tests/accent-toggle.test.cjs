'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../blinkly.user.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  function accentThumb('), source.indexOf('  function applyCfg(')), context);
test('every enabled switch uses contrasting thumbs for white, light, and dark accents', () => {
  for (const accent of ['#ffffff', '#fafafa', '#e9bad8', '#a4dfe2', '#f0dfa8']) assert.equal(context.accentThumb(accent), '#171717', accent);
  for (const accent of ['#000000', '#14191c', '#101080']) assert.equal(context.accentThumb(accent), '#ffffff', accent);
  assert.equal(context.accentThumb('invalid'), context.accentThumb('#ef5b78'));
});
