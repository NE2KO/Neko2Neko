import { useState, useEffect } from 'react';

export default function useDocumentHidden() {
  const [hidden, setHidden] = useState(() => document.hidden);

  useEffect(() => {
    const handler = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  return hidden;
}
