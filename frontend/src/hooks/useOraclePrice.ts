'use client';
import { useState, useEffect } from 'react';
import { HERMES_ENDPOINT } from '../utils/constants';

export function useOraclePrice(feedId: string): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let eventSource: EventSource | null = null;

    const cleanFeedId = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
    const url = `${HERMES_ENDPOINT}/v2/updates/price/stream?ids[]=${cleanFeedId}`;

    eventSource = new EventSource(url);
    eventSource.onmessage = (event) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(event.data);
        const parsed = data?.parsed?.[0]?.price;
        if (parsed) {
          setPrice(Number(parsed.price) * Math.pow(10, parsed.expo));
        }
      } catch {}
    };
    eventSource.onerror = () => {};

    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [feedId]);

  return price;
}
