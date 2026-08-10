import { createElement, useEffect, useState } from 'react';
import { ConnectionManager, MultiplexedStreamingClient } from '@bxios/bxios';

export function App({ url }: { url: string }) {
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    const connection = new ConnectionManager({ url, autoReconnect: true });
    const streaming = new MultiplexedStreamingClient(connection);
    connection.connect();
    let cancelled = false;
    void (async () => {
      for await (const event of streaming.stream<string>({ method: 'GET', path: '/events' }) as any) {
        if (!cancelled) setEvents((current) => [...current, event]);
      }
    })();
    return () => { cancelled = true; connection.disconnect(); };
  }, [url]);
  return createElement('ul', undefined, ...events.map((event, index) =>
    createElement('li', { key: `${event}-${index}` }, event),
  ));
}

// The backend uses @bxios/server's WSServerDriver and MultiplexedStreamingEngine.
