import dns from 'node:dns/promises';
import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const MAX_STORY_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_STORY_HOSTS = new Set([
  'ifarchive.org',
  'www.ifarchive.org',
  'mirror.ifarchive.org',
  'ifdb.org',
  'www.ifdb.org',
  'eblong.com',
]);

const ProxyRequestSchema = z.object({
  url: z.string().url().max(2048),
});

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true; // 10.0.0.0/8
    if (parts[0] === 127) return true; // 127.0.0.0/8
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local / cloud metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.0.0/16
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:169.254.') ||
      normalized.startsWith('::ffff:192.168.')
    ) {
      return true;
    }
  }
  return false;
}

export function isValidZMachineOrBlorb(bytes: Uint8Array): boolean {
  if (bytes.length < 64) return false;
  // Blorb container: "FORM" .... "IFRS"
  const isBlorb =
    bytes[0] === 0x46 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x52 &&
    bytes[3] === 0x4d &&
    bytes[8] === 0x49 &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x52 &&
    bytes[11] === 0x53;
  if (isBlorb) return true;

  // Raw Z-machine story file: byte 0 is version 1..8
  const version = bytes[0];
  return version >= 1 && version <= 8;
}

export async function registerProxyRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/proxy/story', async (request, reply) => {
    const parsed = ProxyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid story URL' });
    }

    let target: URL;
    try {
      target = new URL(parsed.data.url);
    } catch {
      return reply.status(400).send({ error: 'Malformed URL' });
    }

    if (target.protocol !== 'https:') {
      return reply.status(400).send({ error: 'Only HTTPS story URLs are permitted' });
    }

    const hostname = target.hostname.toLowerCase();
    if (!ALLOWED_STORY_HOSTS.has(hostname)) {
      return reply.status(403).send({
        error: `Host "${hostname}" is not on the IF story proxy allowlist. Download the file locally and drag-and-drop it instead.`,
      });
    }

    // Resolve DNS and ensure no private/loopback IP is targeted
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (records.length === 0 || records.some((r) => isPrivateOrReservedIp(r.address))) {
        return reply.status(403).send({ error: 'Resolved address is not permitted' });
      }
    } catch {
      return reply.status(502).send({ error: 'Could not resolve story host' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const upstream = await fetch(target.toString(), {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Zorkaliser/0.1 (+https://github.com/zorkaliser)',
        },
      });

      if (!upstream.ok) {
        return reply.status(502).send({
          error: `Upstream returned HTTP ${upstream.status}`,
        });
      }

      // Verify final URL after redirects is still allowlisted
      const finalUrl = new URL(upstream.url);
      if (finalUrl.protocol !== 'https:' || !ALLOWED_STORY_HOSTS.has(finalUrl.hostname.toLowerCase())) {
        return reply.status(403).send({ error: 'Redirect target is not on the allowlist' });
      }

      const contentLength = Number(upstream.headers.get('content-length') ?? '0');
      if (contentLength > MAX_STORY_BYTES) {
        return reply.status(413).send({ error: 'Story file exceeds 10 MB limit' });
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);
      if (bytes.length > MAX_STORY_BYTES) {
        return reply.status(413).send({ error: 'Story file exceeds 10 MB limit' });
      }

      if (!isValidZMachineOrBlorb(bytes)) {
        return reply.status(422).send({
          error: 'Fetched file is not a valid Z-machine (.z1-.z8) or Blorb (.zblorb) story file',
        });
      }

      const filename = target.pathname.split('/').pop() || 'story.z5';
      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('X-Story-Filename', filename)
        .send(bytes);
    } catch (err) {
      return reply.status(502).send({
        error: err instanceof Error ? err.message : 'Failed to fetch story file',
      });
    } finally {
      clearTimeout(timeout);
    }
  });
}
