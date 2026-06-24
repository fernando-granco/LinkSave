export function safeBaseName(title: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return cleaned || 'video-download';
}
