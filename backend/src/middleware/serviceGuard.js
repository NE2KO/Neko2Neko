import { getStatus } from '../services/registry.js';

const SERVICE_LABELS = {
  mediaVault: 'Media Vault',
  downloader: 'Downloader',
  playlists: 'Playlists',
  adbTransfer: 'ADB Transfer',
};

export function requireService(name) {
  const label = SERVICE_LABELS[name] || name;
  return (req, res, next) => {
    const svc = getStatus(name);
    if (svc && svc.status === 'stopped') {
      return res.status(503).json({
        error: `${label} is stopped`,
        message: `${label} is unavailable while stopped. Start it to resume.`,
        service: name,
        status: 'stopped',
      });
    }
    next();
  };
}
