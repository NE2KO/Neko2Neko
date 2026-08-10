import { useEffect, useState } from 'react';
import { fetchFileById } from '../utils/api';
import { isWaUnsupportedVideo } from '../utils/codec';

// Returns true when the current file is a video whose codec is NOT supported by
// WhatsApp (anything other than H.264 — e.g. HEVC, AV1, VP9), so the WA send
// buttons (Channel / Status / All) should be disabled. Non-video files and
// H.264 videos return false.
export function useWaUnsupported(file) {
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!file || file.type !== 'video') {
      setUnsupported(false);
      return;
    }

    // Already have codec info on the object (e.g. opened via detail route).
    if (file.codec_info != null) {
      setUnsupported(isWaUnsupportedVideo(file));
      return;
    }

    // Otherwise fetch the full record, which includes codec_info.
    setUnsupported(false);
    fetchFileById(file.id)
      .then((f) => { if (!cancelled) setUnsupported(isWaUnsupportedVideo(f)); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [file?.id, file?.type, file?.codec_info]);

  return unsupported;
}
