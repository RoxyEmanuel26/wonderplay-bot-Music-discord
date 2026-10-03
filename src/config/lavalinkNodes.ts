import type { NodeOption } from 'shoukaku';

// Public credentials published by the node operators. Keep TLS nodes ahead of
// plaintext endpoints; the runtime ranker may reorder peers based on health.
export const PUBLIC_LAVALINK_NODES: readonly NodeOption[] = [
  {
    name: 'Node-3 (Serenetia-Global)',
    url: 'lavalinkv4.serenetia.com:443',
    auth: 'https://seretia.link/discord',
    secure: true,
  },
  {
    name: 'Node-7 (Jirayu-TLS)',
    url: 'lavalink.jirayu.net:443',
    auth: 'youshallnotpass',
    secure: true,
  },
  {
    name: 'Node-2 (MilloHost-ID)',
    url: 'lava-v4.millohost.my.id:443',
    auth: 'https://discord.gg/mjS5J2K3ep',
    secure: true,
  },
  {
    name: 'Node-6 (Serenetia-HTTP)',
    url: 'lavalinkv4.serenetia.com:80',
    auth: 'https://seretia.link/discord',
    secure: false,
  },
];
