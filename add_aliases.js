const fs = require('fs');
const path = require('path');

const aliases = {
  'eval': "['ev']",
  'help': "['h']",
  'filter': "['f']",
  'np': "['nowplaying']",
  'pause': "['pa']",
  'ping': "['pg']",
  'resume': "['r', 'res']",
  'stop': "['st']",
  'favorite': "['fav']",
  'playlist': "['pl']",
  'config': "['cfg', 'setting']",
};

const commandsDir = path.join(process.cwd(), 'src', 'commands');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith('.ts')) {
      const commandName = file.replace('.ts', '');
      if (aliases[commandName]) {
        let content = fs.readFileSync(fullPath, 'utf8');
        if (!content.includes('aliases:')) {
          content = content.replace('  execute: async', '  aliases: ' + aliases[commandName] + ',\n  execute: async');
          fs.writeFileSync(fullPath, content);
          console.log('Updated ' + file);
        }
      }
    }
  }
}

walk(commandsDir);
