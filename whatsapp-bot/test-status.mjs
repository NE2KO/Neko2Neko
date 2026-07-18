import { connect, getClient } from './src/connection.js';
import { sendMediaToStatus, sendMediaToChat, sendTextToStatus } from './src/sender.js';

const MODE = process.argv[2] || 'text'; // 'text' | 'video'
const VIDEO = '/home/CATIAA/Videos/itsmeharuu___2025-03-18-15-10-26_1742285426183.mp4';

async function main() {
  console.log('[test-status] connecting WA client (reusing persisted session)...');
  await connect();
  await new Promise(r => setTimeout(r, 3000));
  const client = getClient();
  console.log('[test-status] client ready =', !!client);

  if (MODE === 'text') {
    console.log('[test-status] -> TEXT status (LID-aware sendTextToStatus)');
    try {
      const res = await sendTextToStatus('🧪 test status text', { backgroundColor: '#25D366', fontStyle: 0 });
      console.log('[test-status] TEXT status sent OK ->', JSON.stringify(res));
    } catch (e) {
      console.log('[test-status] TEXT status ERROR:', e && e.stack ? e.stack : String(e));
    }
  } else if (MODE === 'video') {
    console.log('[test-status] -> VIDEO status (LID-aware sendMediaToStatus):', VIDEO);
    try {
      const res = await sendMediaToStatus(VIDEO);
      console.log('[test-status] VIDEO status sent OK ->', JSON.stringify(res));
    } catch (e) {
      console.log('[test-status] VIDEO status ERROR:', e && e.stack ? e.stack : String(e));
    }
  }

  process.exit(0);
}
main().catch(e => { console.error('[test-status] FATAL', e); process.exit(1); });
