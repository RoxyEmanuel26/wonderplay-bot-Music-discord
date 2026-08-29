const fs = require('fs');

function replaceFile(path, search, replace) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(search, replace);
  fs.writeFileSync(path, content, 'utf8');
}

// help.ts
replaceFile('src/commands/general/help.ts', /execute: async \(interaction: ChatInputCommandInteraction/, 'execute: async (ctx: Context');
replaceFile('src/commands/general/help.ts', /interaction\.reply/g, 'ctx.reply');
replaceFile('src/commands/general/help.ts', /interaction\.editReply/g, 'ctx.editReply');
replaceFile('src/commands/general/help.ts', /i: any/g, 'i: any');
replaceFile('src/commands/general/help.ts', /i\)/g, 'i: any)');

// filter.ts
replaceFile('src/commands/music/filter.ts', /if \(\!await hasDJPermissions\(interaction\)\) \{/, 'if (!await hasDJPermissions(ctx.interaction || ctx.message as any)) {');
replaceFile('src/commands/music/filter.ts', /i\)/g, 'i: any)');

// pause.ts
replaceFile('src/commands/music/pause.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');

// queue.ts
replaceFile('src/commands/music/queue.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');
replaceFile('src/commands/music/queue.ts', /i\)/g, 'i: any)');

// resume.ts
replaceFile('src/commands/music/resume.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');

// skip.ts
replaceFile('src/commands/music/skip.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');

// stop.ts
replaceFile('src/commands/music/stop.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');

// volume.ts
replaceFile('src/commands/music/volume.ts', /hasDJPermissions\(interaction\)/, 'hasDJPermissions(ctx.interaction || ctx.message as any)');

// config.ts
replaceFile('src/commands/settings/config.ts', /import { Command } from/, "import { Command } from '../../structures/Command';\nimport { createErrorEmbed } from '../../utils/embeds';\nimport { PermissionsBitField } from 'discord.js';\nimport { Language } from '../../utils/i18n';");

// Context.ts
replaceFile('src/structures/Context.ts', /return await this\.interaction!\.editReply\(options\);/, 'return await this.interaction!.editReply(options as any);');

console.log('Fixed');
