import { type LoaderFunction } from '@remix-run/cloudflare';

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const editorOriginParam = url.searchParams.get('editorOrigin');
  const allowedOrigins = ['https://stackblitz.com', 'https://stackblitz.net'];
  const editorOrigin = editorOriginParam
    ? (() => {
        try {
          const parsed = new URL(editorOriginParam);
          return allowedOrigins.includes(parsed.origin) ? parsed.origin : null;
        } catch {
          return null;
        }
      })()
    : 'https://stackblitz.com';

  if (!editorOrigin) {
    return new Response(null, { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  console.log('editorOrigin', editorOrigin);

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Connect to WebContainer</title>
      </head>
      <body>
        <script type="module">
          (async () => {
            const { setupConnect } = await import('https://cdn.jsdelivr.net/npm/@webcontainer/api@1.6.1-internal.1/dist/connect.js');
            setupConnect({
              editorOrigin: '${editorOrigin}'
            });
          })();
        </script>
      </body>
    </html>
  `;

  return new Response(htmlContent, {
    headers: { 'Content-Type': 'text/html' },
  });
};
