const fs = require('fs');
const path = require('path');

const commandsDir = path.join(__dirname, 'src', 'commands');

function refactorFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  
  if (content.includes('execute: async (ctx: Context')) {
    console.log(`Skipping ${filePath}, already refactored.`);
    return;
  }

  // 1. Replace import { ChatInputCommandInteraction } with import { Context }
  content = content.replace(/ChatInputCommandInteraction(,\s*)?/, '');
  content = content.replace(/import {([^}]*)} from 'discord.js';/, "import { $1 } from 'discord.js';\nimport { Context } from '../../structures/Context';");
  
  // 2. Change execute signature
  content = content.replace(/execute: async \(interaction(:\s*[a-zA-Z]+)?,\s*client\)/, 'execute: async (ctx: Context, client)');
  content = content.replace(/execute: async \(interaction(:\s*[a-zA-Z]+)?,\s*_client\)/, 'execute: async (ctx: Context, _client)');
  
  // 3. Replace all interaction.* with ctx.*
  content = content.replace(/interaction\.reply/g, 'ctx.reply');
  content = content.replace(/interaction\.deferReply/g, 'ctx.deferReply');
  content = content.replace(/interaction\.followUp/g, 'ctx.followUp');
  content = content.replace(/interaction\.editReply/g, 'ctx.editReply');
  content = content.replace(/interaction\.user/g, 'ctx.author');
  content = content.replace(/interaction\.member/g, 'ctx.member');
  content = content.replace(/interaction\.channel/g, 'ctx.channel');
  content = content.replace(/interaction\.guildId/g, 'ctx.guildId');

  // Fix some discord.js imports that might become empty or weird
  content = content.replace(/import {\s*} from 'discord.js';\n/, '');

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Refactored ${filePath}`);
}

function traverse(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      traverse(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      refactorFile(fullPath);
    }
  }
}

traverse(commandsDir);
