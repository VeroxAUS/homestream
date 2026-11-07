// A minimal Chrome DevTools Protocol client for the smoke test: list the pages of the running app and evaluate in one.
export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  return (await response.json()) as CdpTarget[];
}

interface CdpReply {
  id: number;
  result?: { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
  error?: { message: string };
}

/** Evaluates an expression in a page and returns its value (promises are awaited). */
export function evaluate(target: CdpTarget, expression: string, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('The page did not answer in time.'));
    }, timeoutMs);
    const finish = (settle: () => void): void => {
      clearTimeout(timer);
      socket.close();
      settle();
    };
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
    socket.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data)) as CdpReply;
      if (reply.id !== 1) return;
      const failure = reply.error?.message ?? reply.result?.exceptionDetails?.exception?.description;
      finish(() => (failure ? reject(new Error(failure)) : resolve(reply.result?.result?.value)));
    });
    socket.addEventListener('error', () => finish(() => reject(new Error('Could not reach the page over DevTools.'))));
  });
}
