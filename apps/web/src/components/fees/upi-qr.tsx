'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** A UPI QR drawn in the browser from a upi:// link. */
export function UpiQr({ uri, size = 176 }: { uri: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    void QRCode.toDataURL(uri, { margin: 1, width: size * 2 }).then((d) => live && setSrc(d));
    return () => {
      live = false;
    };
  }, [uri, size]);
  return src ? (
    <img src={src} alt="UPI QR code" width={size} height={size} className="rounded-lg border" />
  ) : (
    <div style={{ width: size, height: size }} className="animate-pulse rounded-lg bg-slate-100" />
  );
}
