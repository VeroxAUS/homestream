/** What the UI says while a download start was sent to TorBox but TorBox has not confirmed it (state `pending`). */
export const UNCONFIRMED_LABEL = 'Waiting for TorBox';
export const UNCONFIRMED_CAPTION = 'Sent to TorBox, not confirmed yet. HomeStream keeps checking.';

export function unconfirmedDetail(title: string): string {
  return `Sent "${title}" to TorBox, but it is not confirmed yet. HomeStream keeps checking and will let you know when it's ready.`;
}
