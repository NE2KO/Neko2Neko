// Determines whether a media file can be sent over WhatsApp.
// WA (and therefore Channel/Status) does NOT support HEVC (hvc1/hev1/hevc);
// H.264 (avc1/h264) is fine. Images/audio are always supported.

const H264_RE = /(^|\s)(avc1|h264)(\s|$)/;
const HEVC_RE = /(^|\s)(hev1|hvc1|hevc)(\s|$)/;

// Accepts a parsed object or a JSON string (file.codec_info).
export function isHevcCodec(codecInfo) {
  if (!codecInfo) return false;
  let c = codecInfo;
  if (typeof c === 'string') {
    try { c = JSON.parse(c); } catch { return false; }
  }
  if (!c || typeof c !== 'object') return false;
  const codec = `${c.video_codec || ''} ${c.video_codec_tag || ''}`.toLowerCase();
  if (!codec.trim()) return false;
  return HEVC_RE.test(codec) && !H264_RE.test(codec);
}

export function isVideoHevc(file) {
  if (!file || file.type !== 'video') return false;
  if (isHevcCodec(file.codec_info)) return true;
  const ext = (file.ext || file.name || '').toLowerCase();
  if (ext === '.hevc' || ext === '.h265') return true;
  return false;
}
