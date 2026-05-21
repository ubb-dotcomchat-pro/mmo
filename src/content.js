const fs = require('node:fs');
const path = require('node:path');

function readJsonFile(fileName) {
  const filePath = path.join(__dirname, '..', 'data', fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function byId(items) {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

function loadContent() {
  const zones = readJsonFile('zones.json');
  const archetypes = readJsonFile('archetypes.json');
  const npcs = readJsonFile('npcs.json');

  return {
    archetypes,
    archetypesById: byId(archetypes),
    npcs,
    zones,
    zonesById: byId(zones),
  };
}

module.exports = {
  loadContent,
};
