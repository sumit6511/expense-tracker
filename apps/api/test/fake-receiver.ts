import type { SendResult } from '../src/lib/webhook-http';

export interface Received {
  url: string;
  body: string;
  json: { type: string; timestamp: string; data: any };
  headers: Record<string, string>;
}

/**
 * Stands in for the outside world in webhook tests: records what was sent and answers with a
 * status per URL (200 unless told otherwise). URLs containing "unreachable" fail to connect.
 */
export class FakeReceiver {
  received: Received[] = [];
  private statuses = new Map<string, number>();

  answer(url: string, status: number) {
    this.statuses.set(url, status);
  }

  for(url: string) {
    return this.received.filter((r) => r.url === url);
  }

  send = async (
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<SendResult> => {
    if (url.includes('unreachable')) throw new Error('connect ECONNREFUSED');
    this.received.push({ url, body, json: JSON.parse(body), headers });
    return { status: this.statuses.get(url) ?? 200 };
  };
}
