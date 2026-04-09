import { Router, Request, Response } from 'express';

const router = Router();

// Set to store all connected SSE clients
const sseClients = new Set<Response>();

// Broadcast function to send events to all connected clients
export function broadcast(event: string, data: any): void {
  const payload = JSON.stringify({ type: event, data, timestamp: new Date().toISOString() });
  sseClients.forEach((client) => {
    try {
      client.write(`data: ${payload}\n\n`);
    } catch (error) {
      console.error('Error sending SSE event:', error);
      sseClients.delete(client);
    }
  });
}

// GET /api/events - SSE stream for ALL events
router.get('/', (req: Request, res: Response) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection event (unnamed so onmessage fires)
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Add this client to the set
  sseClients.add(res);

  // Send periodic heartbeat to keep connection alive and confirm status
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 30000);

  // Remove client from set on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    res.end();
  });

  // Handle errors
  req.on('error', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

export default router;
