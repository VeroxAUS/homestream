export interface SseMessage {
  event: string;
  data: string;
}

/** Incremental parser for a `text/event-stream` body: feed chunks, get whole messages. Comments and `retry:` are skipped. */
export function createSseParser(onMessage: (message: SseMessage) => void): (chunk: string) => void {
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  const line = (text: string): void => {
    if (text === '') {
      if (data.length > 0) onMessage({ event, data: data.join('\n') });
      event = 'message';
      data = [];
      return;
    }
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    const value = colon === -1 ? '' : text.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = lines.pop() as string;
    for (const text of lines) line(text);
  };
}
