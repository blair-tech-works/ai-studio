import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // Allow up to 1 minute for PM response

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch('http://localhost:3001/api/prds/drafting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Drafting proxy error:', error);
    const isTimeout = error instanceof DOMException && error.name === 'TimeoutError';
    const isNetwork = error instanceof TypeError; // fetch network failure
    const message = isTimeout
      ? 'PM agent timed out (>60s)'
      : isNetwork
        ? 'Cannot reach orchestrator at localhost:3001 — is it running? Start it with `npm run dev:orchestrator` in a plain terminal.'
        : error instanceof Error
          ? error.message
          : 'PM agent request failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
