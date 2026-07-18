import { connect, getClient, disconnect } from './connection.js';
import { startListener } from './listener.js';
import config from '../config.js';
import { log } from './utils.js';

async function main() {
  log('info', '=== WhatsApp Media Bot starting ===');
  const client = await connect();
  startListener(client);
  log('info', 'Listening for messages...');
  log('info', 'Target channel:', config.targetChatJid);
  log('info', 'Allowed groups:', config.allowedGroups);
  log('info', 'Trigger keywords:', config.triggerKeywords);
  log('info', 'Trigger hashtags:', config.triggerHashtags);

  process.on('SIGINT', async () => {
    log('info', 'Shutting down...');
    await disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'Fatal error:', err.message);
  process.exit(1);
});
